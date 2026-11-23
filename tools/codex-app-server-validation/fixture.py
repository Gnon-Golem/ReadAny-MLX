#!/usr/bin/env python3
"""Deterministic stdio peer for testing one ReadAny development build."""
import json
import os
import re
import sys
import urllib.request
import uuid
from pathlib import Path

thread = ""
turn = ""
approval_id = 100
transport_session = None
marker = os.environ.get("READANY_CODEX_FIXTURE_LOG")
url = next(
    (match[1] for arg in sys.argv
     if (match := re.search(r'url="(http://127\.0\.0\.1:[0-9]+/mcp)"', arg))),
    None,
)
token = os.environ.get("READANY_CODEX_MCP_TOKEN")
state_file = Path("fixture-thread.json")
grant = next(
    (match[1] for arg in sys.argv
     if (match := re.match(r"mcp_servers\.(readany_book_[0-9a-f]+)=", arg))),
    None,
)
mcp_id = 200


def log(event, **values):
    if marker:
        with open(marker, "a", encoding="utf-8") as stream:
            stream.write(json.dumps({"event": event, **values}, ensure_ascii=False) + "\n")


def emit(**packet):
    print(json.dumps(packet, ensure_ascii=False), flush=True)


def notify(method, **params):
    emit(method=method, params={"threadId": thread, **params})


def rpc(method, params, notification=False):
    global transport_session, mcp_id
    assert url and token
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if transport_session:
        headers["Mcp-Session-Id"] = transport_session
    packet = {"jsonrpc": "2.0", "method": method, "params": params}
    if not notification:
        mcp_id += 1
        packet["id"] = mcp_id
    req = urllib.request.Request(url, json.dumps(packet).encode(), headers)
    with urllib.request.urlopen(req, timeout=48) as response:
        transport_session = response.headers.get("Mcp-Session-Id", transport_session)
        body = response.read()
    return json.loads(body)["result"] if body else None


def lookup():
    if not transport_session:
        rpc("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                           "clientInfo": {"name": "fixture", "version": "1"}})
        rpc("notifications/initialized", {}, True)
    result = rpc("tools/call", {
        "name": "readany_search_book",
        "arguments": {"query": "工作记忆", "mode": "bm25", "topK": 1},
    })
    assert not result["isError"], result
    passage = result["structuredContent"]["results"][0]
    log("real-mcp", cfi=passage["cfi"], evidenceId=passage["evidenceId"])
    return passage["evidenceId"]


def message(text):
    item_id = str(uuid.uuid4())
    notify("item/agentMessage/delta", itemId=item_id, turnId=turn, delta=text[:5])
    notify("item/agentMessage/delta", itemId=item_id, turnId=turn, delta=text[5:])
    notify("item/completed", turnId=turn, item={"id": item_id, "type": "agentMessage", "text": text})


def finish(status="completed"):
    notify("turn/completed", turn={"id": turn, "status": status, "items": []})
    log("turn-finished", status=status)


for line in sys.stdin:
    packet = json.loads(line)
    ident, method = packet.get("id"), packet.get("method")
    params = packet.get("params", {})
    if method == "initialize":
        emit(id=ident, result={"userAgent": "fixture"})
    elif method == "config/read":
        servers = {grant: {"enabled": True}} if grant else {}
        emit(id=ident, result={"config": {"mcp_servers": servers}})
    elif method == "model/list":
        emit(id=ident, result={"data": [{"model": "fixture", "isDefault": True, "hidden": False}]})
    elif method == "thread/start":
        assert params["approvalPolicy"] == "on-request" and params["sandbox"] == "read-only"
        thread = str(uuid.uuid4())
        state_file.write_text(thread)
        log("thread-start", thread=thread, book=bool(url))
        emit(id=ident, result={"thread": {"id": thread}, "model": "fixture"})
    elif method == "thread/resume":
        thread = state_file.read_text()
        assert params["threadId"] == thread
        assert params["approvalPolicy"] == "on-request"
        log("thread-resume", thread=thread)
        emit(id=ident, result={"thread": {"id": thread}, "model": "fixture"})
    elif method == "turn/start":
        assert params["sandboxPolicy"] == {"type": "readOnly", "networkAccess": False}
        turn = str(uuid.uuid4())
        text = params["input"][0]["text"]
        notify("turn/started", turn={"id": turn, "status": "inProgress", "items": []})
        emit(id=ident, result={"turn": {"id": turn}})
        if text == "fixture approval":
            emit(id=approval_id, method="item/commandExecution/requestApproval", params={
                "threadId": thread, "turnId": turn, "itemId": "fixture-command",
                "command": "printf fixture", "cwd": str(Path.cwd()), "reason": "Approval test",
            })
        elif text == "fixture stop":
            message("Part before stop")
        elif text == "fixture cite":
            message(f"工作记忆见 [[{lookup()}]]。")
            finish()
        else:
            message("Deterministic streamed reply")
            finish()
    elif method == "turn/interrupt":
        assert params["turnId"] == turn
        emit(id=ident, result={})
        log("interrupted")
        finish("interrupted")
    elif ident == approval_id and "result" in packet:
        decision = packet["result"]["decision"]
        log("approval", decision=decision)
        message(f"Approval result {decision}")
        finish("interrupted" if decision == "cancel" else "completed")
