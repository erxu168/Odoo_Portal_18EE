/**
 * Sending ZPL to a printer over the network. SERVER ONLY.
 *
 * Split out of zpl.ts because that file BUILDS ZPL and is imported by screens:
 * a client component pulling in Node's `net` fails the browser build outright,
 * which is exactly what happened when the inventory label screen started
 * generating its own ZPL. Generation is shared; transport is not.
 *
 * `net` is imported inside the function, not at the top, so nothing about this
 * file can be dragged into a browser bundle by an accidental import.
 */
export async function sendToZebra(ip: string, port: number, zpl: string): Promise<void> {
  const net = await import('net');
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error(`Printer connection timed out (${ip}:${port})`));
    }, 5000);

    socket.connect(port, ip, () => {
      socket.write(zpl, 'utf-8', (err) => {
        clearTimeout(timeout);
        if (err) { socket.destroy(); reject(err); }
        else { socket.end(); resolve(); }
      });
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Printer error (${ip}:${port}): ${err.message}`));
    });
  });
}
