/** 端口探测：首选端口被占时按候选序列递增（纯选择逻辑在 shared/logic） */
import { createServer } from "node:net";
import {
  pickFreePort,
  portCandidates,
  type RuntimePorts,
} from "../../shared/logic/local-runtime-policy";
import {
  LOCAL_API_PORT_PREFERRED,
  LOCAL_PG_PORT_PREFERRED,
  LOCAL_WS_PORT_PREFERRED,
} from "../../shared/config";

/** 尝试在 127.0.0.1:port 监听，成功即释放并返回 true（空闲） */
export function probePortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen({ port, host: "127.0.0.1", exclusive: true });
  });
}

async function pickPort(preferred: number, persisted?: number): Promise<number | null> {
  // 重启优先复用上次的端口（web 端 WS 地址按首选端口构建，复用可最大限度保持一致）
  if (persisted !== undefined && (await probePortFree(persisted))) return persisted;
  const candidates = portCandidates(preferred);
  const occupied = new Set<number>();
  for (const candidate of candidates) {
    if (!(await probePortFree(candidate))) occupied.add(candidate);
  }
  return pickFreePort(candidates, occupied);
}

export async function allocatePorts(persisted?: Partial<RuntimePorts>): Promise<RuntimePorts | null> {
  const [apiPort, wsPort, pgPort] = await Promise.all([
    pickPort(LOCAL_API_PORT_PREFERRED, persisted?.apiPort),
    pickPort(LOCAL_WS_PORT_PREFERRED, persisted?.wsPort),
    pickPort(LOCAL_PG_PORT_PREFERRED, persisted?.pgPort),
  ]);
  if (apiPort === null || wsPort === null || pgPort === null) return null;
  return { apiPort, wsPort, pgPort };
}
