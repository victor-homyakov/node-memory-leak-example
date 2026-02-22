const http = require("http");
const { URL } = require("url");
const { actions, perfController } = require("./perf-controller");

const cache = new Map();

function processRequest(q, locale, res) {
    const cacheKey = `${locale}-${q}`;
    let response;

    if (cache.has(cacheKey)) {
        response = cache.get(cacheKey);
    } else {
        const date = new Date(q);
        response = date.toLocaleString(locale, {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            fractionalSecondDigits: 3,
        });
        cache.set(cacheKey, { date, response });
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(response + "\n");
}

function processPerfRequest(url, req, res) {
    const { pathname } = url;

    if (pathname === "/perf") {
        perfController.getPage(req, res);
    } else if (pathname === `/perf/${actions.dump}`) {
        perfController.makeDumps(req, res);
    } else if (pathname === `/perf/${actions.deleteDumps}`) {
        perfController.deleteDumps(req, res);
    } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Not found: ${req.method} ${pathname}\n`);
    }
}

const requestListener = (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const { pathname } = url;
    console.log(req.method, pathname);

    if (pathname === "/") {
        const q = Number(url.searchParams.get("q")) || Date.now();
        const locale = url.searchParams.get("locale") || "ru-RU";
        processRequest(q, locale, res);
    } else if (pathname.startsWith("/perf")) {
        processPerfRequest(url, req, res);
    } else {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Not found: ${req.method} ${pathname}\n`);
    }
};

const server = http.createServer(requestListener);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Сервер слушает на порту ${PORT}`);
});
