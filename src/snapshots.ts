/** Cursors authenticate an immutable source snapshot and a position, never a page number. */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { SurfingConfigSection } from './config.ts';
import { ReadError } from './errors.ts';
import { estimateTokens } from './tokens.ts';

export type RecordValue = Record<string, string | number | boolean>;
export type Unit = { kind: 'text'; text: string; startSec?: number; endSec?: number }
  | { kind: 'link' | 'part' | 'result'; value: RecordValue };
export interface Material {
  kind: 'page' | 'bili' | 'search'; key: string; source: string; title: string;
  scope: Record<string, string | number | boolean>;
  units: Unit[];
  outline?: Array<{ text: string; url: string }>;
  outlineTruncated?: boolean;
  sourceTruncated?: boolean; truncationReason?: string;
  nextSearchPage?: number;
  sentenceTimes?: Array<{ from: number; to: number }>;
}
interface Snapshot { material: Material; size: number; expiresAtMs: number; materialEstimatedTokens: number; nextSearchCursor?: string }
interface Position { id: string; unit: number; offset: number }
export interface PageResult { text: string; hasMore: boolean; sourceTruncated: boolean; estimatedTokens: number }

export function serializeReceipt(receipt: Record<string, unknown>): string {
  receipt.estimatedTokens = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const text = JSON.stringify(receipt);
    const size = estimateTokens(text);
    if (size === receipt.estimatedTokens) return text;
    receipt.estimatedTokens = size;
  }
  return JSON.stringify(receipt);
}

const clip = (value: string, count: number) => [...value].slice(0, count).join('');

export class SnapshotCache {
  private readonly signingKey = randomBytes(32);
  private readonly snapshots = new Map<string, Snapshot>();
  private bytes = 0;
  constructor(private readonly now: () => number = Date.now) {}

  clear(): void { this.snapshots.clear(); this.bytes = 0; }
  get sizeBytes(): number { return this.bytes; }

  put(input: Material, config: SurfingConfigSection): string {
    this.trim(config.cache.maxBytes);
    const material = structuredClone(input);
    let remaining = config.reading.maxSourceChars;
    const units: Unit[] = [];
    for (const unit of material.units) {
      const source = unit.kind === 'text' ? unit.text : JSON.stringify(unit.value);
      const chars = [...source];
      if (chars.length > remaining) {
        if (unit.kind === 'text' && remaining > 0) units.push({ ...unit, text: chars.slice(0, remaining).join('') });
        material.sourceTruncated = true;
        material.truncationReason = 'source_chars';
        break;
      }
      units.push(unit);
      remaining -= chars.length;
    }
    material.units = units;
    material.title = clip(material.title, 100);
    material.scope = Object.fromEntries(Object.entries(material.scope).slice(0, 20)
      .map(([key, value]) => [key, typeof value === 'string' ? clip(value, 120) : value]));
    if (material.outline) {
      const outline: NonNullable<Material['outline']> = [];
      for (const item of material.outline) {
        const value = { text: clip(item.text, 80), url: item.url };
        const length = [...JSON.stringify(value)].length;
        if (length > remaining) {
          material.outlineTruncated = true; material.sourceTruncated = true; material.truncationReason = 'source_chars';
          break;
        }
        outline.push(value); remaining -= length;
      }
      material.outline = outline;
    }
    const size = Buffer.byteLength(JSON.stringify(material));
    if (size > config.cache.maxBytes) throw new ReadError('source_limit', '单份材料超出文本缓存上限，无法保存续读快照。');
    this.trim(config.cache.maxBytes - size);
    const id = randomBytes(12).toString('hex');
    this.snapshots.set(id, {
      material, size, expiresAtMs: this.now() + config.cache.ttlMs,
      materialEstimatedTokens: estimateTokens(units.map(unit => unit.kind === 'text' ? unit.text : JSON.stringify(unit.value)).join('')),
    });
    this.bytes += size;
    return this.encode({ id, unit: 0, offset: 0 });
  }

  read(cursor: string, expectedKey: string, config: SurfingConfigSection): PageResult {
    this.trim(config.cache.maxBytes);
    const start = this.decode(cursor);
    const snapshot = this.snapshots.get(start.id);
    if (!snapshot) throw new ReadError('cursor_expired', '续读快照已到期或被释放，请重新读取。');
    if (snapshot.material.key !== expectedKey) throw new ReadError('cursor_mismatch', '游标与本次工具、目标或分P不匹配，请沿用原调用参数。');
    this.snapshots.delete(start.id);
    this.snapshots.set(start.id, snapshot);
    const { material } = snapshot;
    const sourceUrlOmitted = material.source.length > 1200;
    const receipt: Record<string, unknown> = {
      status: 'ok', source: sourceUrlOmitted ? new URL(material.source).origin : material.source,
      ...(sourceUrlOmitted ? { sourceUrlOmitted: true } : {}), title: material.title, scope: material.scope,
      materialEstimatedTokens: snapshot.materialEstimatedTokens,
      content: '', links: [], parts: [], results: [],
      sourceTruncated: material.sourceTruncated ?? false,
      ...(material.truncationReason ? { truncationReason: material.truncationReason } : {}),
    };
    const current = { ...start };
    const finish = () => {
      const hasMore = current.unit < material.units.length || (!!material.nextSearchPage && !material.sourceTruncated);
      return serializeReceipt({ ...receipt, hasMore,
        nextCursor: hasMore ? this.encode(current) : null,
        ...(!hasMore && material.nextSearchPage ? { nextSearchPage: material.nextSearchPage } : {}),
        range: { fromUnit: start.unit, fromOffset: start.offset, toUnit: current.unit, toOffset: current.offset },
      });
    };
    const cap = config.reading.maxResponseEstimatedTokens;
    if (estimateTokens(finish()) > cap) throw new ReadError('source_limit', '来源信息超过返回上限，无法生成完整回执。');
    if (start.unit === 0 && start.offset === 0 && (material.outline?.length || material.outlineTruncated)) {
      const outline: unknown[] = [];
      receipt.outline = outline;
      for (const item of material.outline ?? []) {
        outline.push(item);
        // Reserve most of the page for the requested text.
        if (estimateTokens(finish()) > Math.min(cap / 3, 1000)) { outline.pop(); break; }
      }
      receipt.outlinePartial = !!material.outlineTruncated || outline.length < (material.outline?.length ?? 0);
    }
    while (current.unit < material.units.length) {
      const unit = material.units[current.unit];
      if (unit.kind !== 'text') {
        const field = unit.kind === 'link' ? 'links' : unit.kind === 'part' ? 'parts' : 'results';
        const records = receipt[field] as RecordValue[];
        records.push(unit.value);
        current.unit++;
        if (estimateTokens(finish()) > cap) {
          records.pop(); current.unit--;
          if (current.unit === start.unit && current.offset === start.offset) {
            receipt.status = 'response_limit';
            receipt.reason = '单条记录超出返回上限；提高配置后用此游标继续。';
          }
          break;
        }
        continue;
      }
      const chars = [...unit.text];
      const previous = receipt.content as string;
      const previousOffset = current.offset;
      const previousUnit = current.unit;
      const previousTime = receipt.timeRange;
      if (unit.startSec !== undefined) receipt.timeRange = {
        fromSec: (previousTime as { fromSec: number } | undefined)?.fromSec ?? unit.startSec, toSec: unit.endSec,
      };
      let low = 0, high = Math.min(chars.length - previousOffset, cap * 4);
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        receipt.content = previous + chars.slice(previousOffset, previousOffset + middle).join('');
        current.offset = previousOffset + middle;
        if (current.offset === chars.length) { current.unit++; current.offset = 0; }
        if (estimateTokens(finish()) <= cap) low = middle; else high = middle - 1;
        current.unit = previousUnit;
        current.offset = previousOffset;
      }
      let taken = low;
      if (previousOffset + taken < chars.length) {
        const text = chars.slice(previousOffset, previousOffset + taken).join('');
        const boundary = text.lastIndexOf('\n\n');
        if (boundary >= 0) {
          const length = [...text.slice(0, boundary + 2)].length;
          if (length >= taken * 0.8) taken = length;
        }
      }
      receipt.content = previous + chars.slice(previousOffset, previousOffset + taken).join('');
      current.offset = previousOffset + taken;
      if (!taken) {
        if (previousTime === undefined) delete receipt.timeRange; else receipt.timeRange = previousTime;
        if (current.unit === start.unit && current.offset === start.offset) {
          receipt.status = 'response_limit'; receipt.reason = '返回上限不足以容纳正文；提高配置后用此游标继续。';
        }
      }
      if (current.offset === chars.length) { current.unit++; current.offset = 0; }
      else break;
    }
    const text = finish();
    if (estimateTokens(text) > cap) throw new ReadError('source_limit', '返回信息超过配置上限。');
    return { text, hasMore: current.unit < material.units.length || (!!material.nextSearchPage && !material.sourceTruncated),
      sourceTruncated: material.sourceTruncated ?? false, estimatedTokens: estimateTokens(text) };
  }

  nextSearch(cursor: string, expectedKey: string, config: SurfingConfigSection): { page: number; cursor?: string } | undefined {
    this.trim(config.cache.maxBytes);
    const position = this.decode(cursor);
    const snapshot = this.snapshots.get(position.id);
    if (!snapshot) throw new ReadError('cursor_expired', '搜索快照已到期，请重新搜索。');
    if (snapshot.material.key !== expectedKey) throw new ReadError('cursor_mismatch', '游标与搜索词不匹配。');
    if (position.unit === snapshot.material.units.length && snapshot.material.nextSearchPage && !snapshot.material.sourceTruncated) {
      if (snapshot.nextSearchCursor) {
        const child = this.decode(snapshot.nextSearchCursor);
        if (!this.snapshots.has(child.id)) throw new ReadError('cursor_expired', '下一页搜索快照已释放，请重新搜索。');
      }
      return { page: snapshot.material.nextSearchPage, cursor: snapshot.nextSearchCursor };
    }
    return undefined;
  }

  rememberSearchNext(cursor: string, nextCursor: string): void {
    const position = this.decode(cursor);
    const snapshot = this.snapshots.get(position.id);
    if (snapshot) snapshot.nextSearchCursor = nextCursor;
  }

  private trim(maxBytes: number): void {
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expiresAtMs <= this.now()) { this.bytes -= snapshot.size; this.snapshots.delete(id); }
    }
    while (this.bytes > maxBytes && this.snapshots.size) {
      const [id, snapshot] = this.snapshots.entries().next().value!;
      this.bytes -= snapshot.size; this.snapshots.delete(id);
    }
  }

  private encode(position: Position): string {
    const value = Buffer.from(`${position.id}:${position.unit}:${position.offset}`).toString('base64url');
    return value + '.' + createHmac('sha256', this.signingKey).update(value).digest().subarray(0, 12).toString('base64url');
  }

  private decode(cursor: string): Position {
    if (typeof cursor !== 'string' || cursor.length > 256) throw new ReadError('cursor_expired', '无效的续读游标。');
    const [value, signature] = cursor.split('.');
    const expected = createHmac('sha256', this.signingKey).update(value ?? '').digest().subarray(0, 12);
    const actual = Buffer.from(signature ?? '', 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ReadError('cursor_expired', '无效或其他实例的续读游标。');
    const [id, unit, offset] = Buffer.from(value, 'base64url').toString().split(':');
    return { id, unit: Number(unit), offset: Number(offset) };
  }
}
