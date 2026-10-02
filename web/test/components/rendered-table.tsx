import { Table } from "@/app/(console)/ui/table";
import { RENDERED, ROWS, type Row } from "./fixtures";

/**
 * A story, in its own file, because `Column.render` is a function and the
 * component rig turns a function prop into an asynchronous callback across
 * the browser boundary — so the column cannot be handed to `mount()`. The
 * table that uses it is mounted instead (Playwright's "test story").
 */
export function RenderedTable() {
  return <Table<Row> columns={RENDERED} rows={ROWS} rowKey="id" empty="No harnesses yet." />;
}
