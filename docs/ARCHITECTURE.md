# Deploying SurrealDB on TiKV over Amazon EKS with SST & Pulumi

## 1. Architecture Overview

```
Internet / Hono Service
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│ Amazon VPC (Public & Private Subnets + Managed NAT)      │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Amazon EKS Cluster (SurrealDBCluster + gp3 EBS)    │  │
│  │                                                    │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ Namespace: kong                              │  │  │
│  │  │  └─ Kong Ingress Controller (LoadBalancer)   │  │  │
│  │  └──────────────────────┬───────────────────────┘  │  │
│  │                         ▼                          │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ Namespace: default                           │  │  │
│  │  │  └─ SurrealDB v2.2.2 Helm Release            │  │  │
│  │  │     path: tikv://basic-pd.tidb-cluster:2379  │  │  │
│  │  └──────────────────────┬───────────────────────┘  │  │
│  │                         ▼                          │  │
│  │  ┌──────────────────────────────────────────────┐  │  │
│  │  │ Namespace: tidb-cluster (TiDB Operator 1.6.1)│  │  │
│  │  │  ├─ PD NodeGroup   (dedicated=pd, gp3 1Gi)   │  │  │
│  │  │  ├─ TiKV NodeGroup (dedicated=tikv, gp3 10Gi)│  │  │
│  │  │  └─ TiDB NodeGroup (dedicated=tidb)          │  │  │
│  │  └──────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

## 2. Step-by-Step Setup Instructions

1. **Install dependencies:**
   ```bash
   pnpm install
   ```
2. **Configure AWS credentials:**
   ```bash
   aws configure
   export AWS_REGION=us-east-1
   ```
3. **Set environment variables (optional overrides):**
   ```bash
   export SURREALDB_NS=production
   export SURREALDB_DB=app
   ```
4. **Deploy with SST:**
   ```bash
   npx sst deploy --stage dev
   ```

## 3. Verifying the Cluster & Testing Hono

1. Export the generated kubeconfig:
   ```bash
   npx sst shell -- kubectl get pods -A
   ```
2. Retrieve the Kong LoadBalancer external hostname:
   ```bash
   kubectl get svc -n kong kong-kong-proxy -o jsonpath='{.status.loadBalancer.ingress[0].hostname}'
   ```
3. Start the Hono service locally or invoke the deployed Function URL:
   ```bash
   cd examples/hono-service
   SURREALDB_URL="http://<KONG_LB_HOSTNAME>:80/rpc" pnpm dev
   ```
4. Test CRUD operations:
   ```bash
   curl -X GET http://localhost:3000/health
   curl -X POST http://localhost:3000/users -H "Content-Type: application/json" -d '{"name":"Alice","role":"engineer"}'
   curl -X GET http://localhost:3000/users
   ```

## 4. Troubleshooting Guide

- **Pods stuck in `Pending`:** Verify that the `aws-ebs-csi-driver` addon is `ACTIVE` and that each ManagedNodeGroup has matching `dedicated` labels and `NoSchedule` taints matching the `TidbCluster` spec.
- **TiKV PD connection timeout:** Ensure `surrealdb.path` is set to `tikv://basic-pd.tidb-cluster:2379` and `basic-pd-0` is `1/1 Running`.

## 5. Cleanup

```bash
npx sst remove --stage dev
```
