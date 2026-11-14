/// <reference path="./.sst/platform/config.d.ts" />

import { setupSurrealdb } from "./surrealdb";

export default $config({
  app(input) {
    return {
      name: "sst-eks-surrealdb",
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
        eks: "2.7.1",
        kubernetes: "4.18.1",
      },
    };
  },
  async run() {
    const vpc = new sst.aws.Vpc("SurrealDBVpc", {
      nat: "managed",
    });

    const { kubeconfig, clusterName, surrealdbUrl } = await setupSurrealdb(vpc);

    const surrealResource = new sst.Linkable("SurrealDB", {
      properties: {
        URL: process.env.SURREALDB_URL || surrealdbUrl,
        USER: process.env.SURREALDB_USER || "root",
        PASS: process.env.SURREALDB_PASS || "root",
        NS: process.env.SURREALDB_NS || "test",
        DB: process.env.SURREALDB_DB || "test",
      },
    });

    const honoService = new sst.aws.Function("HonoService", {
      handler: "examples/hono-service/index.handler",
      url: true,
      vpc,
      link: [surrealResource],
      environment: {
        SURREALDB_URL: process.env.SURREALDB_URL || surrealdbUrl,
        SURREALDB_USER: process.env.SURREALDB_USER || "root",
        SURREALDB_PASS: process.env.SURREALDB_PASS || "root",
        SURREALDB_NS: process.env.SURREALDB_NS || "test",
        SURREALDB_DB: process.env.SURREALDB_DB || "test",
      },
    });

    return {
      clusterName,
      kubeconfig,
      surrealdbUrl,
      honoServiceUrl: honoService.url,
    };
  },
});
