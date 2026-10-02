/** The tooltip stories (01 §13, W6-D94). Not a test file: a story exports
 *  components and nothing else, and the spec passes the words in. */
import { HelpMark } from "@/app/(console)/ui/help-mark";
import { Modal } from "@/app/(console)/ui/modal";
import { Table, type TableColumn } from "@/app/(console)/ui/table";

/**
 * The Endpoints table's shape (04 §14) at the width that made W6-D7
 * necessary: nine columns wider than the rig's viewport, so the last
 * heading's `(?)` sits against the right edge inside `Table`'s
 * `overflow-x-auto` wrapper — clipped by the wrapper and cut by the viewport
 * before the bubble was portalled.
 */
const KEYS = [
  "host", "outcome", "reason", "setBy", "count", "first", "last", "sessions", "allow",
] as const;

type Row = Record<(typeof KEYS)[number], string>;

const ROWS: Row[] = [
  { host: "github.com", outcome: "refused", reason: "Not on the allow-list.",
    setBy: "Organization", count: "4", first: "21 hours ago", last: "20 hours ago",
    sessions: "2", allow: "Allow" },
];

export function WideTable({ help }: { help: string }) {
  const columns: TableColumn<Row>[] = KEYS.map((key) => ({
    key,
    heading: key,
    kind: "text",
    width: "180px",
    sort: false,
    help: key === "allow" ? help : `What the ${key} column holds.`,
  }));
  return <Table<Row> columns={columns} rows={ROWS} rowKey="host" empty="Nothing yet." />;
}

/** A `(?)` pinned to the bottom edge: the flip-above case. */
export function BottomMark({ help }: { help: string }) {
  return (
    <div style={{ position: "fixed", bottom: "2px", left: "24px" }}>
      <HelpMark text={help} />
    </div>
  );
}

/**
 * A `(?)` inside a native `<dialog>`. The bubble goes to the dialog and not
 * to the body: the dialog is in the top layer, and a node at the body paints
 * under its backdrop (01 §11, D94).
 */
export function MarkInDialog({ help }: { help: string }) {
  return (
    <Modal title="Remove this host" onClose={() => {}}>
      <p>
        Something with help in it <HelpMark text={help} />
      </p>
    </Modal>
  );
}
