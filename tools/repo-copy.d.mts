export declare function repoFiles(root: string): string[];
export declare function copyTracked(
  root: string,
  dest: string,
  opts?: { include?: readonly string[]; exclude?: readonly string[] },
): number;
