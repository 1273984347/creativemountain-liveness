/** 一类地形的契约项（见 `rules-book-contract.mjs`）。 */
export interface TerrainContract {
  /** glossary 键（占位符名）。 */
  readonly term: string;
  /** 规格 §3.4 表格里的通用名。 */
  readonly specName: string;
  /** 规则书里必须存在的小节标题。 */
  readonly section: string;
  /** 小节内必须出现的要点。 */
  readonly required: readonly string[];
}

export declare const TERRAIN_CONTRACT: readonly TerrainContract[];
export declare const TERRAIN_NO_EFFECT: readonly string[];
export declare const RULES_BOOK_GLOBAL_REQUIRED: readonly string[];

export declare function sectionBody(narration: string, heading: string): string;
export declare function specTerrainNames(spec: string): string[] | null;
export declare function checkRulesBookTerrain(
  spec: string,
  narration: string,
): { id: string; title: string; ok: boolean; detail: string };
