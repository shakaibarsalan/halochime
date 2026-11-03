import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const { GET, POST, PATCH, PUT, DELETE } = toNextJsHandler((req: Request) => getAuth().handler(req));
