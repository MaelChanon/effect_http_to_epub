import { availableParallelism } from "node:os"

process.env["UV_THREADPOOL_SIZE"] ??= String(Math.max(4, availableParallelism()))
