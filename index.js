const http = require("http");
const { URL } = require("url");

const cache = new Map();

const requestListener = (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const q = Number(url.searchParams.get("q")) || Date.now();
    const locale = url.searchParams.get("locale") || "ru-RU";
    const cacheKey = `${locale}-${q}`;
    let response;

    if (cache.has(cacheKey)) {
        response = cache.get(cacheKey);
    } else {
        response = new Date(q).toLocaleString(locale, {
            day: "numeric",
            month: "long",
            year: "numeric",
            hour: "numeric",
            minute: "numeric",
            second: "numeric",
            fractionalSecondDigits: 3,
        });
        cache.set(cacheKey, response);
    }

    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(response + "\n");
};

const server = http.createServer(requestListener);
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Сервер слушает на порту ${PORT}`);
});
