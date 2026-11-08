export declare function repoFiles(root: string): string[];
export declare function copyTracked(
  root: string,
  dest: string,
  opts?: { include?: readonly string[]; exclude?: readonly string[] },
): number;
export declare const DOC_SYNC_INCLUDE: readonly string[];
export declare function makeIsolatedRepo(root: string, include?: readonly string[]): string;
export declare function removeIsolatedRepo(dir: string): void;
