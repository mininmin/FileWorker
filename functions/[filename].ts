import {
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import mime from "mime/lite";

import Env from "./utils/Env";
import { createS3Client, auth } from "./utils/utils";

// ==================== 文件下载 ==================== //
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { params, env, request } = context;
  const { filename } = params;
  const { BUCKET } = env;
  const s3 = createS3Client(env);

  // ✅ 自动支持无扩展名文件、URL 解码、尾部斜杠等情况
  let key = decodeURIComponent(filename as string);
  if (key.endsWith("/")) key = key.slice(0, -1);

  const command = new GetObjectCommand({
    Bucket: BUCKET!,
    Key: key,
  });

  let response: GetObjectCommandOutput;
  try {
    response = await s3.send(command);
  } catch (e) {
    return new Response("Not found", { status: 404 });
  }

  const headers = new Headers();
  for (const [key, value] of Object.entries(response.Metadata)) {
    headers.set(key, value);
  }

  // ✅ 自动检测 MIME 类型；无扩展名文件默认 application/octet-stream
  const contentType =
    response.ContentType !== "application/octet-stream"
      ? response.ContentType
      : mime.getType(key) || "application/octet-stream";

  headers.set("content-type", contentType);

  // 若被标记为 text 类型，则强制 UTF-8 输出
  if (response.Metadata["x-store-type"] === "text") {
    headers.set("content-type", "text/plain;charset=utf-8");
  }

  headers.set("content-length", response.ContentLength.toString());
  headers.set("last-modified", response.LastModified.toUTCString());
  headers.set("etag", response.ETag);

  // ✅ 无论有无扩展名，都允许公开文件直接下载
  if (headers.get("x-store-visibility") !== "public" && !auth(env, request)) {
    return new Response("Not found", { status: 404 });
  }

  // ✅ 增加 Content-Disposition，便于 wget/curl 自动识别
  headers.set("content-disposition", `inline; filename="${key}"`);

  return new Response(response.Body.transformToWebStream(), {
    headers,
  });
};

// ==================== 上传 ==================== //
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { params, env, request } = context;
  if (!auth(env, request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { filename } = params;
  const { BUCKET } = env;
  const s3 = createS3Client(env);
  const headers = new Headers(request.headers);
  const x_store_headers = [];
  for (const [key, value] of headers.entries()) {
    if (key.startsWith("x-store-")) {
      x_store_headers.push([key, value]);
    }
  }
  const parallelUploads3 = new Upload({
    client: s3,
    params: {
      Bucket: BUCKET,
      Key: decodeURIComponent(filename as string),
      Body: request.body,
      Metadata: Object.fromEntries(x_store_headers),
    },
    queueSize: 4,
    partSize: 1024 * 1024 * 5,
    leavePartsOnError: false,
  });
  await parallelUploads3.done();
  return new Response("OK", { status: 200 });
};

// ==================== 修改元数据 ==================== //
export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const { params, env, request } = context;
  if (!auth(env, request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { filename } = params;
  const { BUCKET } = env;
  const s3 = createS3Client(env);
  const headers = new Headers(request.headers);
  const x_store_headers = [];
  for (const [key, value] of headers.entries()) {
    if (key.startsWith("x-store-")) {
      x_store_headers.push([key, value]);
    }
  }
  const command = new CopyObjectCommand({
    Bucket: BUCKET!,
    CopySource: `${BUCKET}/${decodeURIComponent(filename as string)}`,
    Key: decodeURIComponent(filename as string),
    MetadataDirective: "REPLACE",
    Metadata: Object.fromEntries(x_store_headers),
  });
  await s3.send(command);
  return new Response("OK", { status: 200 });
};

// ==================== 删除 ==================== //
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { params, env, request } = context;
  if (!auth(env, request)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { filename } = params;
  const { BUCKET } = env;
  const s3 = createS3Client(env);
  const command = new DeleteObjectCommand({
    Bucket: BUCKET!,
    Key: decodeURIComponent(filename as string),
  });
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  await fetch(url, { method: "DELETE" });
  return new Response("OK", { status: 200 });
};

// ==================== 默认拦截 ==================== //
export const onRequest: PagesFunction<Env> = async () => {
  return new Response("Method not allowed", { status: 405 });
};
