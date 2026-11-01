// The speech socket opener: Node's own WebSocket client, reduced to the calls a speech client makes
// and the events it answers to. The speaker opens its socket through this, and a test stands in for
// it with an opener of the same shape, so nothing in the speech client touches the network itself.

/** An open socket, reduced to the two calls a speech client makes. */
export type SpeechSocket = {
  send: (data: Uint8Array | string) => void;
  close: () => void;
};

/**
 * Opens a socket to `url` with `headers` on the handshake. `onMessage` takes each text frame and
 * `onAudio` each binary frame. `onClose` fires at most once, when the socket closes or fails, with
 * a detail fit for the log.
 */
export type OpenSpeechSocket = (input: {
  url: string;
  headers: Record<string, string>;
  onOpen: () => void;
  onMessage: (text: string) => void;
  onAudio: (pcm: Buffer) => void;
  onClose: (detail: string) => void;
}) => SpeechSocket;

/** Opens through Node's own WebSocket client, which sends the handshake headers it is given. */
export const openWithWebSocket: OpenSpeechSocket = ({ url, headers, onOpen, onMessage, onAudio, onClose }) => {
  const socket = new WebSocket(url, { headers });
  socket.binaryType = "arraybuffer";
  let finished = false;
  const finish = (detail: string): void => {
    if (finished) return;
    finished = true;
    onClose(detail);
  };
  socket.addEventListener("open", () => onOpen());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") onMessage(event.data);
    else if (event.data instanceof ArrayBuffer) onAudio(Buffer.from(event.data));
  });
  socket.addEventListener("error", () => finish("the socket failed"));
  socket.addEventListener("close", (event) => finish(`the socket closed with code ${String(event.code)}`));
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(1000),
  };
};
