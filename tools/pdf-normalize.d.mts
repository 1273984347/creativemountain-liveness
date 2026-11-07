// pdf-normalize.mjs 的类型声明（纯 JS 工具的 TS 侧契约）。
//
// 工具本体是 .mjs（零 TS 编译负担、可被 Node 直接执行），
// 但测试是 .ts 且受 tsc 门禁管辖，故在此补声明。

import type { Buffer } from 'node:buffer';

export declare function normalizePdfBytes(buffer: Buffer): Buffer;
export declare function normalizedPdfDigest(buffer: Buffer): string;
export declare function rawPdfDigest(buffer: Buffer): string;
