#!/bin/bash
cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"
PYTHON="$ROOT/.venv/bin/python"
DASHBOARD="$ROOT/experiments/five-imu-dashboard/server.py"
ROUTER="$ROOT/experiments/five-voice-midi/router.py"
ESTIMATOR="$ROOT/experiments/bmi323-gravity/server.py"
LOGS="$HOME/Library/Logs/Feral Fingers"
STATE="$HOME/Library/Caches/Feral Fingers"
URL="http://127.0.0.1:8767/harmonic-explorer"
mkdir -p "$LOGS" "$STATE" || exit 1
notice() {
  if [ "${FF_SERVICES_ONLY:-0}" = 1 ]; then printf '%s\n' "$1"; return; fi
  /usr/bin/osascript - "$1" <<'APPLESCRIPT'
on run argv
  display dialog (item 1 of argv) with title "Harmonic Explorer" buttons {"OK"} default button "OK"
end run
APPLESCRIPT
}
fail() { notice "$1"; exit 1; }
if [ ! -x "$PYTHON" ] || ! "$PYTHON" -c 'import serial, rtmidi' 2>/dev/null; then
  fail "The Feral Fingers Python environment is missing or incomplete. Expected $PYTHON with pyserial and python-rtmidi installed."
fi
if [ "${FF_SERVICES_ONLY:-0}" != 1 ] && ! /usr/bin/osascript -e 'id of application "Google Chrome"' >/dev/null 2>&1; then
  fail "Google Chrome could not be found. Install Google Chrome, then start Harmonic Explorer again."
fi
LOCK="$STATE/harmonic-explorer-start.lock"
locked=false
for i in {1..60}; do
  if mkdir "$LOCK" 2>/dev/null; then locked=true; printf '%s\n' "$$" > "$LOCK/pid"; break; fi
  if [ -f "$LOCK/pid" ]; then
    read -r owner < "$LOCK/pid"
    case "$owner" in ''|*[!0-9]*) ;; *) if ! kill -0 "$owner" 2>/dev/null; then rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null; fi;; esac
  fi
  sleep .2
done
$locked || fail "Another Harmonic Explorer launch is still in progress. Please try again."
trap 'rm -f "$LOCK/pid"; rmdir "$LOCK" 2>/dev/null' EXIT
listener() { /usr/sbin/lsof -nP -tiTCP:"$1" -sTCP:LISTEN; }
is_script() {
  local cmd
  cmd=$(/bin/ps -p "$1" -o command= 2>/dev/null)
  case "$cmd" in *"$2"*) return 0;; *) return 1;; esac
}
start_service() {
  local name="$1" port="$2" script="$3" pid existing label
  existing=$(listener "$port")
  if [ -n "$existing" ]; then
    case "$existing" in *$'\n'*) fail "Port $port has multiple listeners. No processes were stopped.";; esac
    is_script "$existing" "$script" || fail "Port $port is used by another application. Close that application and try again."
    return 0
  fi
  printf '\n--- Started %s ---\n' "$(date)" >> "$LOGS/$name.log"
  if [ "${FF_SERVICES_ONLY:-0}" = 1 ]; then
    label="com.feralfingers.control.$name"
    if /bin/launchctl list "$label" >/dev/null 2>&1; then
      fail "$name has a registered control service but is not listening. Stop it from the control menu and try again."
    fi
    /bin/launchctl submit -l "$label" -o "$LOGS/$name.log" -e "$LOGS/$name.log" -- "$PYTHON" -u "$script" || fail "Could not start the $name service."
    pid=''
  else
    /usr/bin/nohup "$PYTHON" -u "$script" >> "$LOGS/$name.log" 2>&1 < /dev/null &
    pid=$!
    printf '%s\n' "$pid" > "$STATE/$name.pid"
  fi
  for i in {1..100}; do
    if /usr/bin/curl -fsS --max-time 1 "http://127.0.0.1:$port/status" >/dev/null 2>&1; then
      existing=$(listener "$port")
      if [ -z "$pid" ] && is_script "$existing" "$script"; then printf '%s\n' "$existing" > "$STATE/$name.pid"; return 0; fi
      [ "$existing" = "$pid" ] && return 0
      fail "Port $port was taken by another process while starting $name. Check $LOGS/$name.log."
    fi
    if [ -n "$pid" ]; then kill -0 "$pid" 2>/dev/null || break; fi
    sleep .2
  done
  fail "$name could not start. Check $LOGS/$name.log. For the router, enable IAC Driver Bus 1 in Audio MIDI Setup."
}
start_service dashboard 8766 "$DASHBOARD"
revision=$("$PYTHON" -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()+open(sys.argv[2],"rb").read()).hexdigest())' "$ROUTER" "$ESTIMATOR") || fail "Could not inspect the router files."
current=$(listener 8767)
if [ -n "$current" ]; then
  case "$current" in *$'\n'*) fail "Port 8767 has multiple listeners. No processes were stopped.";; esac
  is_script "$current" "$ROUTER" || fail "Port 8767 is used by another application. No process was stopped."
  running=$(/usr/bin/curl -fsS --max-time 2 http://127.0.0.1:8767/status | "$PYTHON" -c 'import json,sys; print(json.load(sys.stdin).get("router_revision", ""))' 2>/dev/null)
  if [ "$running" != "$revision" ]; then
    kill -TERM "$current" 2>/dev/null || fail "The existing router could not be stopped safely."
    # A launchd-managed router may restart itself; wait for it instead of starting a duplicate.
    supervised=false
    if /bin/launchctl list com.feralfingers.router.manual 2>/dev/null | /usr/bin/grep -Fq "$ROUTER" || /bin/launchctl list com.feralfingers.control.router 2>/dev/null | /usr/bin/grep -Fq "$ROUTER"; then supervised=true; fi
    for i in {1..100}; do
      next=$(listener 8767)
      if [ -n "$next" ] && [ "$next" != "$current" ]; then
        is_script "$next" "$ROUTER" || fail "Another application took port 8767 during restart."
        break
      fi
      if [ -z "$next" ] && ! kill -0 "$current" 2>/dev/null && ! $supervised; then break; fi
      sleep .2
    done
    next=$(listener 8767)
    if [ "$next" = "$current" ]; then fail "The old router did not stop. No other process was started."; fi
    if [ -z "$next" ] && $supervised; then fail "The supervised router did not restart. Check its launch service and try again."; fi
  fi
fi
start_service router 8767 "$ROUTER"
ready=false
for i in {1..100}; do
  if /usr/bin/curl -fsS --max-time 1 http://127.0.0.1:8767/status | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); assert d.get("router_revision")==sys.argv[1] and d.get("output_available")' "$revision" 2>/dev/null && /usr/bin/curl -fsS --max-time 1 "$URL" >/dev/null 2>&1; then ready=true; break; fi
  sleep .2
done
$ready || fail "The latest router or MIDI output is not ready. Enable IAC Driver Bus 1 in Audio MIDI Setup and check $LOGS/router.log."
pid=$(listener 8767)
[ -n "$pid" ] && printf '%s\n' "$pid" > "$STATE/router.pid"
sensors=false
for i in {1..50}; do
  if /usr/bin/curl -fsS --max-time 1 http://127.0.0.1:8767/status | "$PYTHON" -c 'import json,sys; d=json.load(sys.stdin); assert all(d.get("sensor_fresh",[])) and len(d["sensor_fresh"])==5' 2>/dev/null; then sensors=true; break; fi
  sleep .2
done
if ! $sensors; then
  notice "The router is running, but all five finger sensors are not reporting fresh data. Check that the Feather is connected and running the five-IMU firmware. The Explorer will still open so you can inspect its status."
fi
if [ "${FF_SERVICES_ONLY:-0}" != 1 ]; then
  /usr/bin/open -a "Google Chrome" "$URL" || fail "Google Chrome could not open Harmonic Explorer. Check that Chrome is installed and try again."
fi
