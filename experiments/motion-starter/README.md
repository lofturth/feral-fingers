# Motion starter

Small local-network experiment: iPhone Safari streams motion to a Mac browser. This is independent of piano-trainer and does not play sound.

## Start

Requires Node.js and an HTTPS certificate/key **already trusted by the iPhone**. The certificate must cover the Mac hostname used in Safari. From this directory:

```sh
npm ci
MOTION_HTTPS_CERT=/path/to/existing/cert.pem MOTION_HTTPS_KEY=/path/to/existing/key.pem npm run start
```

In another terminal:

```sh
npm run relay
```

Open `https://<Mac-hostname>.local:5184/` on the Mac and `https://<Mac-hostname>.local:5184/?phone=1` in iPhone Safari. Tap **Enable motion sensors** on the phone. Both devices must be on a reachable local network. The web server uses port 5184; the relay listens only on Mac loopback port 8784, through the web server's WebSocket proxy. These ports are separate from piano-trainer's 5173/8765. Refresh pages manually after edits; Vite HMR is disabled.

The phone sends raw, nullable orientation and motion values and its own browser event timestamps. Phone timestamps are not synchronized to the Mac clock. The Mac shows live values, connection state, and the age of the last sample. Only one phone controller may connect at once. No samples or history are stored.

## Check

```sh
npm run build
npm test
```

The automated test checks a nullable sample and disconnect status. Actual iPhone Safari permission, HTTPS trust, motion delivery, backgrounding, and network interruption still require device testing.
