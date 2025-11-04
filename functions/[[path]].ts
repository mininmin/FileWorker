import { onRequestGet as fileHandler } from "./[filename]";
import Env from "./utils/Env";

// ✅ 允许无扩展名路径（如 /smartdns-aarch64）使用相同逻辑处理
export const onRequestGet: PagesFunction<Env> = async (context) => {
  // 将 /xxx 这种路径转成 filename 形式
  const url = new URL(context.request.url);
  const path = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  context.params = { filename: path } as any;

  // 调用原始文件下载逻辑
  return fileHandler(context);
};
