#!/usr/bin/env python3
"""Test ACP UI lifecycle and the real local ReadAny MCP without a Google account."""
import json
import os
from pathlib import Path
import sys
import urllib.request
import uuid

trace_path = os.environ.get("READANY_ACP_FIXTURE_LOG")
state_path = Path("acp-fixture-session.json")
session = {}
mcp = []
active_request = None
mcp_transport = None
mcp_id = 0


def trace(event, **data):
    if trace_path:
        with open(trace_path, "a", encoding="utf-8") as file:
            print(json.dumps({"event": event, **data}, ensure_ascii=False), file=file)


def send(**packet):
    print(json.dumps({"jsonrpc": "2.0", **packet}, ensure_ascii=False), flush=True)


def respond(request, **result):
    send(id=request, result=result)


def update(tag, **payload):
    send(method="session/update", params={
        "sessionId": session["id"],
        "update": {"sessionUpdate": tag, **payload},
    })


def options():
    specs = {
        "model": ("Model", ["gemini-fixture", "gemini-fixture-alt", "third-party"]),
        "thought_level": ("Thinking Level", ["low", "high"]),
        "mode": ("Mode", ["default", "plan", "auto", "accept-edits"]),
    }
    return [
        {"id": key, "name": label, "category": key, "type": "select",
         "currentValue": session.get(key, choices[0]),
         "options": [{"value": val, "name": val} for val in choices]}
        for key, (label, choices) in specs.items()
    ]


def save():
    state_path.write_text(json.dumps(session), encoding="utf-8")


def mcp_call(method, params, notification=False):
    global mcp_transport, mcp_id
    assert len(mcp) == 1
    target = mcp[0]
    assert target["type"] == "http" and target["url"].startswith("http://127.0.0.1:")
    headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
    headers.update({item["name"]: item["value"] for item in target["headers"]})
    if mcp_transport:
        headers["Mcp-Session-Id"] = mcp_transport
    packet = {"jsonrpc": "2.0", "method": method, "params": params}
    if not notification:
        mcp_id += 1
        packet["id"] = mcp_id
    request = urllib.request.Request(target["url"], json.dumps(packet).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        mcp_transport = response.headers.get("Mcp-Session-Id", mcp_transport)
        body = response.read()
    return json.loads(body)["result"] if body else None


def cite():
    if not mcp_transport:
        mcp_call("initialize", {"protocolVersion": "2025-11-25", "capabilities": {},
                               "clientInfo": {"name": "acp-fixture", "version": "1"}})
        mcp_call("notifications/initialized", {}, True)
    ident = "mcp-search"
    update("tool_call", toolCallId=ident, title="ReadAny MCP search", kind="search", status="in_progress")
    result = mcp_call("tools/call", {"name": "readany_search_book",
                              "arguments": {"query": "工作记忆", "mode": "bm25", "topK": 1}})
    passage = result["structuredContent"]["results"][0]
    trace("real-mcp", evidence=passage["evidenceId"], cfi=passage["cfi"])
    update("tool_call_update", toolCallId=ident, status="completed")
    return passage["evidenceId"]


def say(text):
    midpoint = len(text) // 2
    for chunk in (text[:midpoint], text[midpoint:]):
        update("agent_message_chunk", content={"type": "text", "text": chunk})


if "--settings" in sys.argv:
    settings = json.loads(sys.argv[sys.argv.index("--settings") + 1])
    trace("startup", sandbox="--sandbox" in sys.argv, toolPermission=settings["toolPermission"],
          agentMode=settings.get("agentMode"))

for line in sys.stdin:
    request = json.loads(line)
    method, ident, params = request.get("method"), request.get("id"), request.get("params", {})
    if method == "initialize":
        assert params["protocolVersion"] == 1 and params["clientCapabilities"] == {}
        respond(ident, protocolVersion=1, agentCapabilities={"loadSession": True, "mcpCapabilities": {"http": True},
                         "sessionCapabilities": {"resume": {}, "close": {}}})
    elif method in ("session/new", "session/resume", "session/load"):
        assert params["cwd"] == str(Path.cwd())
        mcp = params["mcpServers"]
        if method == "session/new":
            session = {"id": str(uuid.uuid4())}
            save()
        else:
            session = json.loads(state_path.read_text(encoding="utf-8"))
            assert params["sessionId"] == session["id"]
        trace(method, session=session["id"], scoped=bool(mcp))
        respond(ident, sessionId=session["id"], configOptions=options())
    elif method == "session/set_config_option":
        session[params["configId"]] = params["value"]
        save()
        trace("config", id=params["configId"], value=params["value"])
        respond(ident, configOptions=options())
    elif method == "session/prompt":
        text = params["prompt"][0]["text"]
        active_request = ident
        if "fixture approval" in text:
            send(id="approval-acp", method="session/request_permission", params={
                "sessionId": session["id"],
                "toolCall": {"toolCallId": "test", "title": "Run harmless fixture", "kind": "execute",
                             "rawInput": {"command": "printf fixture"}},
                "options": [{"optionId": "once", "name": "Allow once", "kind": "allow_once"},
                            {"optionId": "reject", "name": "Reject once", "kind": "reject_once"}]})
        elif "fixture stop" in text:
            say("ACP partial before stop")
        else:
            if "fixture cite" in text:
                say(f"工作记忆见 [[{cite()}]]。")
            else:
                say("ACP streamed reply")
            respond(ident, stopReason="end_turn")
            active_request = None
    elif method == "session/cancel":
        assert active_request is not None
        trace("cancelled")
        respond(active_request, stopReason="cancelled")
        active_request = None
    elif method == "session/close":
        respond(ident)
    elif ident == "approval-acp" and "result" in request:
        outcome = request["result"]["outcome"]
        trace("permission", outcome=outcome)
        say("ACP permission response recorded")
        respond(active_request, stopReason="end_turn")
        active_request = None
