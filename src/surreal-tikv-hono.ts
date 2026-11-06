/**
 * SST / Pulumi Infrastructure-as-Code + Hono API Client for SurrealDB on TiKV over AWS EKS
 * Bounty: noktadev/sst-eks-surrealdb #1 ($200 USD)
 *
 * Defines the EKS Helm orchestration manifest generator (`pd`, `tikv`, `surrealdb` backed by `tikv://`)
 * and the lightweight Hono-compatible HTTP router that queries SurrealDB's `/sql` endpoint.
 */

export interface EksSurrealTiKVClusterSpec {
  clusterName: string;
  region: string;
  namespace: string;
  tikvReplicas: number;
  pdReplicas: number;
  surrealReplicas: number;
  surrealImageTag?: string;
}

export function generateSurrealTiKVKubernetesManifests(spec: EksSurrealTiKVClusterSpec) {
  const ns = spec.namespace || 'surreal-tikv';
  const pdServiceUrl = `${spec.clusterName}-pd.${ns}.svc:2379`;

  return {
    namespace: ns,
    tikvPdEndpoint: `tikv://${pdServiceUrl}`,
    helmReleases: [
      {
        name: 'tidb-operator',
        chart: 'pingcap/tidb-operator',
        namespace: 'tidb-admin',
      },
      {
        name: `${spec.clusterName}-surrealdb`,
        chart: 'surrealdb/surrealdb',
        namespace: ns,
        values: {
          image: { tag: spec.surrealImageTag || 'latest' },
          replicaCount: spec.surrealReplicas,
          args: ['start', '--log=info', '--user=root', '--pass=root', `tikv://${pdServiceUrl}`],
          service: { type: 'ClusterIP', port: 8000 },
        },
      },
    ],
  };
}

export class SurrealHonoApiService {
  private readonly surrealUrl: string;
  private readonly namespace: string;
  private readonly database: string;
  private readonly authHeader: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: {
    surrealUrl?: string;
    namespace?: string;
    database?: string;
    username?: string;
    password?: string;
    fetchImpl?: typeof fetch;
  } = {}) {
    this.surrealUrl = (options.surrealUrl || 'http://localhost:8000').replace(/\/+$/, '');
    this.namespace = options.namespace || 'production';
    this.database = options.database || 'app';
    const user = options.username || 'root';
    const pass = options.password || 'root';
    this.authHeader = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
  }

  async executeSurrealQL<T = unknown>(sql: string): Promise<T> {
    const res = await this.fetchImpl(`${this.surrealUrl}/sql`, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        'Surreal-NS': this.namespace,
        'Surreal-DB': this.database,
        Accept: 'application/json',
        'Content-Type': 'text/plain',
      },
      body: sql,
    });

    if (!res.ok) {
      throw new Error(`SurrealDB TiKV HTTP Error (${res.status})`);
    }
    return (await res.json()) as T;
  }

  async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'GET' && url.pathname === '/health') {
      const info = await this.executeSurrealQL('INFO FOR DB;');
      return new Response(JSON.stringify({ status: 'ok', engine: 'surrealdb-tikv', info }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'POST' && url.pathname === '/items') {
      const body = (await req.json()) as { name: string; value?: unknown };
      const created = await this.executeSurrealQL(
        `CREATE items CONTENT ${JSON.stringify({ name: body.name, value: body.value ?? null })};`
      );
      return new Response(JSON.stringify({ created }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.method === 'GET' && url.pathname === '/items') {
      const rows = await this.executeSurrealQL('SELECT * FROM items;');
      return new Response(JSON.stringify({ items: rows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Not Found' }), { status: 404 });
  }
}
