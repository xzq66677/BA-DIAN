import { once } from 'node:events';
import { Agent, type Server as HttpServer } from 'node:http';
import * as streams from 'node:stream';

type ServerModule = typeof import('../../server/src/index.js');

export interface TestServer {
  url: string;
  agent?: Agent;
  close(): Promise<void>;
}

/** Feed Node's HTTP parser through paired streams when the runner has no TCP loopback. */
function createInProcessAgent(server: HttpServer): Agent {
  const pair = streams.duplexPair;
  if (!pair) throw new Error('In-process HTTP tests require Node 22.6 or later');

  const agent = new Agent();
  agent.createConnection = () => {
    const [client, incoming] = pair();
    for (const socket of [client, incoming]) {
      Object.assign(socket, {
        setTimeout: () => socket,
        setNoDelay: () => socket,
        setKeepAlive: () => socket,
      });
    }
    server.emit('connection', incoming);
    return client;
  };
  return agent;
}

export async function startTestServer({ httpServer, io, rooms }: ServerModule): Promise<TestServer> {
  const agent = process.env.BADIAN_IN_PROCESS_TEST === '1' ? createInProcessAgent(httpServer) : undefined;
  let url = 'http://badian.test';
  if (!agent) {
    const listening = once(httpServer, 'listening');
    httpServer.listen(0, '127.0.0.1');
    await listening;
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Test server has no TCP address');
    url = `http://127.0.0.1:${address.port}`;
  }
  return {
    url,
    agent,
    async close() {
      for (const room of rooms.values()) room.dispose();
      rooms.clear();
      agent?.destroy();
      await io.close();
    },
  };
}
