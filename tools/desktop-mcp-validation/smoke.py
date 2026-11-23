"""Verify a granted ReadAny MCP session using a synthetic book fixture."""
import argparse
import json
import stat
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

PROTOCOL = "2025-11-25"
TOOL_NAMES = {
    "readany_get_context",
    "readany_search_book",
    "readany_read_chapter",
    "readany_get_toc",
    "readany_get_evidence",
}


class MCP:
    def __init__(self, path: Path):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600, "Connection file must be private"
        data = json.loads(path.read_text())
        parsed = urlparse(data["url"])
        assert parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
        self.url = data["url"]
        self.book_id = data["bookId"]
        self.token = data["token"]
        self.session = None
        self.request_id = 0

    def send(self, method, params=None, *, notification=False, headers=None):
        self.request_id += 1
        packet = {"jsonrpc": "2.0", "method": method, "params": params or {}}
        if not notification:
            packet["id"] = self.request_id
        merged = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            **(headers or {}),
        }
        if self.session:
            merged["Mcp-Session-Id"] = self.session
            merged["MCP-Protocol-Version"] = PROTOCOL
        request = urllib.request.Request(self.url, json.dumps(packet).encode(), merged)
        try:
            response = urllib.request.urlopen(request, timeout=55)
        except urllib.error.HTTPError as error:
            return error.code, error.headers, None
        with response:
            data = response.read()
            return response.status, response.headers, json.loads(data) if data else None

    def call(self, name, **arguments):
        status, _, result = self.send("tools/call", {"name": name, "arguments": arguments})
        assert status == 200, status
        return result

    def close(self):
        request = urllib.request.Request(self.url, method="DELETE", headers={
            "Authorization": f"Bearer {self.token}",
            "Mcp-Session-Id": self.session,
            "MCP-Protocol-Version": PROTOCOL,
        })
        with urllib.request.urlopen(request, timeout=8) as response:
            assert response.status == 204


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("connection", type=Path)
    parser.add_argument("--query", required=True, help="Terms from the synthetic book")
    parser.add_argument("--unindexed", action="store_true")
    parser.add_argument("--expected-evidence")
    args = parser.parse_args()
    client = MCP(args.connection)
    assert client.send("ping", headers={"Authorization": "Bearer wrong"})[0] == 401
    assert client.send("ping", headers={"Origin": "http://example.test"})[0] == 403
    assert client.send("tools/list")[0] == 400
    status, headers, response = client.send("initialize", {
        "protocolVersion": PROTOCOL,
        "clientInfo": {"name": "ReadAny-validation", "version": "1"},
        "capabilities": {},
    })
    assert status == 200 and response["result"]["protocolVersion"] == PROTOCOL
    client.session = headers["Mcp-Session-Id"]
    assert client.send("notifications/initialized", notification=True)[0] == 202
    try:
        tools = client.send("tools/list")[2]["result"]["tools"]
        assert {tool["name"] for tool in tools} == TOOL_NAMES
        assert all(tool["annotations"]["readOnlyHint"] for tool in tools)
        ctx = client.call("readany_get_context")["result"]["structuredContent"]
        assert ctx["bookId"] == client.book_id and ctx["indexed"] != args.unindexed
        illegal = client.call("readany_search_book", query=args.query, bookId="another-book")
        assert illegal["result"]["isError"], illegal
        assert client.call("readany_get_evidence", evidenceId="book-99999")["result"]["isError"]
        if args.expected_evidence:
            restored = client.call("readany_get_evidence", evidenceId=args.expected_evidence)["result"]
            assert not restored["isError"], restored
            assert restored["structuredContent"]["bookId"] == client.book_id

        search = client.call("readany_search_book", query=args.query, mode="vector", topK=3)
        assert not search["result"]["isError"], search
        result = search["result"]["structuredContent"]
        if args.unindexed:
            assert result["searchMode"] == "keyword-fallback", result
        else:
            assert result["vectorStatus"] == "matched", result
        passage = result["results"][0]
        assert passage["cfi"].startswith("epubcfi("), passage
        if not args.unindexed:
            assert passage["chunkId"], passage
        evidence_id = passage["evidenceId"]
        if args.expected_evidence:
            assert evidence_id == args.expected_evidence
        repeated = client.call("readany_search_book", query=args.query, mode="vector", topK=3)
        assert repeated["result"]["structuredContent"]["results"][0]["evidenceId"] == evidence_id
        evidence = client.call("readany_get_evidence", evidenceId=evidence_id)["result"]["structuredContent"]
        assert evidence["bookId"] == client.book_id and evidence["cfi"] == passage["cfi"]
        chapter = client.call("readany_read_chapter", chapterIndex=passage["chapterIndex"])
        assert chapter["result"]["structuredContent"]["sourceRefs"]
        toc = client.call("readany_get_toc")
        assert not toc["result"]["isError"], toc
        print(json.dumps({
            "toolCount": len(tools),
            "bookId": client.book_id,
            "indexed": ctx["indexed"],
            "index": ctx["index"],
            "evidenceId": evidence_id,
            "chunkId": passage.get("chunkId"),
            "cfi": evidence["cfi"],
            "chapter": evidence["chapterTitle"],
        }, ensure_ascii=False))
    finally:
        client.close()


if __name__ == "__main__":
    main()
