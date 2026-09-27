/**
 * 构建期常量。esbuild 通过 define 注入 __APP_URL__ / __CHANNEL__ / __PRODUCT_NAME__；
 * 未注入时（tsc、单测、dev 直跑源码）回退到默认值。
 */

declare const __APP_URL__: string | undefined;
declare const __CHANNEL__: string | undefined;
declare const __PRODUCT_NAME__: string | undefined;
declare const __IS_TEST__: boolean | undefined;
declare const __LOCAL_MODE__: boolean | undefined;

/** 生产默认服务器地址（规格书 §4.2 / §4.6） */
export const DEFAULT_APP_URL = "https://pm.hezongji.cn";

/** 更新源目录（规格书 §4.4） */
export const DEFAULT_UPDATES_URL = "https://pm.hezongji.cn/updates/";

/** 测试构建标识（dist:test 注入）：与正式包彻底隔离——appId/单实例锁/AppUserModelId/数据目录互不干扰 */
export const BUILD_IS_TEST: boolean =
 typeof __IS_TEST__ === "boolean" ? __IS_TEST__ : false;

/** Windows AppUserModelId —— 系统通知归属与任务栏分组的前提（规格书 §4.1 第 2 步） */
export const APP_USER_MODEL_ID = BUILD_IS_TEST
 ? "io.github.hezongji.pm-desktop.test"
 : "io.github.hezongji.pm-desktop";

/** 应用数据目录名（%APPDATA%/pm-desktop，规格书 §4.1 第 3 步 / D6 卸载清理目标） */
export const APP_DATA_DIR_NAME = BUILD_IS_TEST
 ? "pm-desktop-test"
 : "pm-desktop";

/** 持久会话分区名（规格书 §4.2） */
export const SESSION_PARTITION = "persist:pm";

export const BUILD_CHANNEL: string =
 typeof __CHANNEL__ === "string" && __CHANNEL__ ? __CHANNEL__ : "stable";

export const BUILD_APP_URL: string =
 typeof __APP_URL__ === "string" && __APP_URL__ ? __APP_URL__ : DEFAULT_APP_URL;

export const BUILD_PRODUCT_NAME: string =
 typeof __PRODUCT_NAME__ === "string" && __PRODUCT_NAME__
  ? __PRODUCT_NAME__
  : "PM桌面";

/** 自动更新检查间隔：4 小时（规格书 §4.4） */
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/**
 * 本地全栈模式（2.0 方向，DEVIATIONS.md D3-1）：内嵌 Next 服务 + im-server + 嵌入式 PostgreSQL，
 * 数据落 userData。false 时退化为 1.x 云端薄壳行为（调试用逃生门，经 config.json appUrl 覆盖触发）。
 */
export const LOCAL_MODE: boolean =
  typeof __LOCAL_MODE__ === "boolean" ? __LOCAL_MODE__ : true;

/** 本地服务首选端口（被占用时按 local-runtime-policy.portCandidates 递增探测） */
export const LOCAL_API_PORT_PREFERRED = 4310;
export const LOCAL_WS_PORT_PREFERRED = 4312;
export const LOCAL_PG_PORT_PREFERRED = 54329;

/** 本地数据库名 */
export const LOCAL_DB_NAME = "pm_local";
