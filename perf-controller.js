const fs = require("node:fs");
const { Session } = require("node:inspector");
const os = require("node:os");
const path = require("node:path");

const minNumberOfDumps = 1;
const maxNumberOfDumps = 5;

const minInterval = 20;
const maxInterval = 7200;

const logContents = [];

const actions = {
    dump: "dump",
    deleteDumps: "delete-dumps",
};

function getPage(_req, res) {
    const hostname = os.hostname();
    const tmpdir = os.tmpdir();
    const scpCommand = `scp nobody@${hostname}:${tmpdir}/profile.\\* ./`;
    const cpCommand = `cp ${tmpdir}/profile.* ./`;
    const pre = (content) => `<pre>${content}</pre>`;

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Profiles</title>
<style>form { margin: 16px 0 }</style>
</head>
<body>
<p>Hostname: ${hostname}</p>
<p>Временный каталог: ${tmpdir}</p>
<p>${scpCommand ? pre(scpCommand) : ""}</p>
<p>${cpCommand ? pre(cpCommand) : ""}</p>
<p>Память Node на этой машине: ${JSON.stringify(getMemoryUsageMb())}</p>

<form method="GET" action="/perf/${actions.dump}">
    <label>
        Сколько дампов снять (${minNumberOfDumps}-${maxNumberOfDumps}):
        <input type="number" name="numberOfDumps" value="3" min="${minNumberOfDumps}" max="${maxNumberOfDumps}" />
    </label>
    <label>
        Интервал между дампами, с (${minInterval}-${maxInterval}):
        <input type="number" name="interval" value="${minInterval}" min="${minInterval}" max="${maxInterval}" />
    </label>
    <button type="submit">Снять дампы</button>
</form>

<form method="POST" action="/perf/${actions.deleteDumps}">
    <button type="submit">Удалить все дампы на машине</button>
</form>

<p>Лог:</p>
${pre(logContents.join("\n"))}
</body>
</html>`);
}

function getMemoryUsageMb() {
    const mb = (n) => Math.round(n / 1024 / 1024) + " МБ";
    const memoryUsage = process.memoryUsage();

    return {
        rss: mb(memoryUsage.rss),
        heapTotal: mb(memoryUsage.heapTotal),
        heapUsed: mb(memoryUsage.heapUsed),
        external: mb(memoryUsage.external),
        arrayBuffers: mb(memoryUsage.arrayBuffers),
    };
}

let dumpInProgress = false;

async function makeDumps(req, res) {
    if (dumpInProgress) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(pageWithMessageAndRedirect(`На машине ${os.hostname()} дамп уже в процессе снятия`));
    }

    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    const numberOfDumps = Number(url.searchParams.get("numberOfDumps"));
    if (isNaN(numberOfDumps) || numberOfDumps < minNumberOfDumps || numberOfDumps > maxNumberOfDumps) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end(`Неправильное значение параметра numberOfDumps "${url.searchParams.get("numberOfDumps")}"`);
    }

    const interval = Number(url.searchParams.get("interval"));
    if (isNaN(interval) || interval < minInterval || interval > maxInterval) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end(`Неправильное значение параметра interval "${url.searchParams.get("interval")}"`);
    }

    const message =
        numberOfDumps > 1
            ? `Снимаю дампы (${numberOfDumps} шт.) с интервалом ${interval} с на машине ${os.hostname()}. Во время снятия каждого дампа хост на какое-то время перестанет отвечать на запросы.`
            : `Снимаю дамп на машине ${os.hostname()}. Хост на какое-то время перестанет отвечать на запросы.`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    // res.end(message);
    res.end(pageWithMessageAndRedirect(message));

    try {
        dumpInProgress = true;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await takeHeapSnapshots(numberOfDumps, interval);
    } catch (err) {
        console.error(err);
    } finally {
        dumpInProgress = false;
    }
}

async function takeHeapSnapshots(numberOfDumps, interval) {
    let fd = null;
    let i = 0;

    // Важно: сессия должна быть одна для всех снимаемых дампов, чтобы их можно было сравнивать между собой
    // В разных сессиях у одного объекта могут быть разные адреса, например `@44500` и `@52400`
    const session = new Session();
    session.connect();
    session.on("HeapProfiler.addHeapSnapshotChunk", (m) => {
        if (fd !== null) {
            fs.writeSync(fd, m.params.chunk);
        } else {
            log("Файл дампа не открыт");
        }
    });

    while (i < numberOfDumps) {
        if (i > 0) {
            await new Promise((resolve) => setTimeout(resolve, interval * 1000));
        }

        if (fd !== null) {
            log("Файл дампа ещё не закрыт, ожидаю закрытия...");
            continue;
        }

        const dumpFileName = `profile.${Date.now()}.${i}.heapsnapshot`;
        const dumpFilePath = path.join(os.tmpdir(), dumpFileName);
        let err;

        try {
            fd = fs.openSync(dumpFilePath, "w");

            log(`HeapProfiler.takeHeapSnapshot ${os.hostname()} ${dumpFilePath}`);
            err = await new Promise((resolve) => {
                session.post("HeapProfiler.takeHeapSnapshot", undefined, (err) => {
                    resolve(err);
                });
            });

            fs.closeSync(fd);
            fd = null;
            i++;
        } catch (e) {
            err = e;
        }

        if (err) {
            const message = `Ошибка сохранения дампа ${dumpFilePath}`;
            log(message);
            console.error(message);
            console.error(err);
        } else {
            log(`Дамп на машине ${os.hostname()} сохранён в ${dumpFilePath}`);
        }
    }

    session.disconnect();
}

function deleteDumps(_req, res) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(pageWithMessageAndRedirect(`Удаляю все снятые дампы на машине ${os.hostname()}`));
    removeFiles(/profile\..+\.heapsnapshot$/);
}

function removeFiles(regExp) {
    const tmpPath = os.tmpdir();

    fs.readdirSync(tmpPath)
        .filter((f) => regExp.test(f))
        .forEach((f) => fs.unlinkSync(path.join(tmpPath, f)));
}

function pageWithMessageAndRedirect(message) {
    log(message);

    return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>${message}</title>
<meta http-equiv="refresh" content="2; url=/perf" />
</head>
<body>${message}</body>
</html>`;
}

function log(message) {
    if (logContents.length > 1000) {
        logContents.shift();
    }

    logContents.push(message);
    console.info(message);
}

const perfController = { getPage, makeDumps, deleteDumps };

module.exports = { actions, perfController };
