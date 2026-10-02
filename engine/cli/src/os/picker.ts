import { join } from "node:path";
import { appleString, psString, type Shell } from "./shell.js";

/**
 * W5-D13's two native conversations: the one that asks where a session should
 * run, and the one that says why it will not. A link from the console has no
 * terminal yet, so both have to be windows the operating system draws.
 */

export type Choice =
	/** A folder, absolute, made if it had to be. */
	| { kind: "folder"; path: string }
	/** The person closed the dialog. A sentence, not a failure. */
	| { kind: "cancelled"; sentence: string }
	/** Nothing on this machine can draw a dialog; say what to type instead. */
	| { kind: "no-picker"; sentence: string };

const ASK = "Where should this session run?";
const EXISTING = "Open an existing folder";
const NEW = "Create a new workspace";
const PICK_EXISTING = "Choose the folder this session should run in";
const PICK_PARENT = "Choose where the new workspace should go";
const NAME_IT = "Name the new workspace";
const DEFAULT_NAME = "workspace";
const CANCELLED = "Nothing was chosen, so no session was started.";
const NO_PICKER = "This machine has no folder picker (`zenity` or `kdialog`), so the folder cannot be asked for.";

const osa = (os: Shell, script: string) => os.run("osascript", ["-e", script]);
const pwsh = (os: Shell, script: string) => os.run("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
const FORMS = "Add-Type -AssemblyName System.Windows.Forms;";

/** Every dialog trims; a `choose folder` also carries a trailing separator. */
const clean = (out: string): string => out.trim().replace(/\/+$/, "");

/**
 * The flow W5-D13 names: *Open an existing folder* or *Create a new
 * workspace*, then the folder itself, then — for the second — the new name.
 * A cancel at any step is a cancel.
 */
export async function chooseWorkspace(os: Shell): Promise<Choice> {
	if (os.platform === "darwin") return await onMac(os);
	if (os.platform === "win32") return await onWindows(os);
	return await onLinux(os);
}

async function onMac(os: Shell): Promise<Choice> {
	const asked = await osa(
		os,
		`display dialog "${appleString(ASK)}" with title "Harness" buttons {"Cancel", "${NEW}", "${EXISTING}"} default button "${EXISTING}"`,
	);
	// osascript exits non-zero when the person hits Cancel; that exit *is* the
	// answer, not a fault.
	if (asked.code !== 0) return { kind: "cancelled", sentence: CANCELLED };
	const fresh = asked.stdout.includes(NEW);
	const chosen = await osa(os, `POSIX path of (choose folder with prompt "${appleString(fresh ? PICK_PARENT : PICK_EXISTING)}")`);
	if (chosen.code !== 0 || clean(chosen.stdout) === "") return { kind: "cancelled", sentence: CANCELLED };
	if (!fresh) return { kind: "folder", path: clean(chosen.stdout) };
	const named = await osa(
		os,
		`text returned of (display dialog "${appleString(NAME_IT)}" with title "Harness" default answer "${DEFAULT_NAME}")`,
	);
	return await make(os, clean(chosen.stdout), named.code === 0 ? named.stdout : "");
}

async function onWindows(os: Shell): Promise<Choice> {
	const asked = await pwsh(os, `${FORMS} [System.Windows.Forms.MessageBox]::Show('${psString(`${ASK}\n\nYes — ${EXISTING}.  No — ${NEW}.`)}','Harness','YesNoCancel')`);
	const answer = asked.stdout.trim();
	if (answer !== "Yes" && answer !== "No") return { kind: "cancelled", sentence: CANCELLED };
	const fresh = answer === "No";
	const chosen = await pwsh(
		os,
		`${FORMS} $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '${psString(fresh ? PICK_PARENT : PICK_EXISTING)}'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }`,
	);
	if (chosen.stdout.trim() === "") return { kind: "cancelled", sentence: CANCELLED };
	if (!fresh) return { kind: "folder", path: chosen.stdout.trim() };
	const named = await pwsh(
		os,
		`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::InputBox('${psString(NAME_IT)}','Harness','${DEFAULT_NAME}')`,
	);
	return await make(os, chosen.stdout.trim(), named.stdout);
}

async function onLinux(os: Shell): Promise<Choice> {
	if (await os.has("zenity")) {
		// `--extra-button` prints its own label and exits 1, so the three
		// answers are distinguishable without a list dialog.
		const asked = await os.run("zenity", ["--question", "--title=Harness", `--text=${ASK}`, `--ok-label=${EXISTING}`, "--cancel-label=Cancel", `--extra-button=${NEW}`]);
		const fresh = asked.stdout.trim() === NEW;
		if (!fresh && asked.code !== 0) return { kind: "cancelled", sentence: CANCELLED };
		const chosen = await os.run("zenity", ["--file-selection", "--directory", `--title=${fresh ? PICK_PARENT : PICK_EXISTING}`]);
		if (chosen.code !== 0 || chosen.stdout.trim() === "") return { kind: "cancelled", sentence: CANCELLED };
		if (!fresh) return { kind: "folder", path: clean(chosen.stdout) };
		const named = await os.run("zenity", ["--entry", "--title=Harness", `--text=${NAME_IT}`, `--entry-text=${DEFAULT_NAME}`]);
		return await make(os, clean(chosen.stdout), named.code === 0 ? named.stdout : "");
	}
	if (await os.has("kdialog")) {
		const asked = await os.run("kdialog", ["--title", "Harness", "--yesnocancel", `${ASK}\n\nYes — ${EXISTING}.  No — ${NEW}.`]);
		if (asked.code !== 0 && asked.code !== 1) return { kind: "cancelled", sentence: CANCELLED };
		const fresh = asked.code === 1;
		const chosen = await os.run("kdialog", ["--title", fresh ? PICK_PARENT : PICK_EXISTING, "--getexistingdirectory", os.home]);
		if (chosen.code !== 0 || chosen.stdout.trim() === "") return { kind: "cancelled", sentence: CANCELLED };
		if (!fresh) return { kind: "folder", path: clean(chosen.stdout) };
		const named = await os.run("kdialog", ["--title", "Harness", "--inputbox", NAME_IT, DEFAULT_NAME]);
		return await make(os, clean(chosen.stdout), named.code === 0 ? named.stdout : "");
	}
	return { kind: "no-picker", sentence: NO_PICKER };
}

/** The second choice: the folder does not exist yet, so it is made. */
async function make(os: Shell, parent: string, name: string): Promise<Choice> {
	const wanted = name.trim();
	if (wanted === "") return { kind: "cancelled", sentence: CANCELLED };
	const path = join(parent, wanted);
	await os.mkdir(path);
	return { kind: "folder", path };
}

/**
 * A refusal a link caused has no terminal to land in, so it is a window as
 * well as a line (W5-D13). Best effort: a machine with no dialog still gets
 * the line, which `open` always prints.
 */
export async function alert(os: Shell, message: string): Promise<void> {
	if (os.platform === "darwin") {
		await osa(os, `display dialog "${appleString(message)}" with title "Harness" buttons {"OK"} default button "OK" with icon stop`);
		return;
	}
	if (os.platform === "win32") {
		await pwsh(os, `${FORMS} [System.Windows.Forms.MessageBox]::Show('${psString(message)}','Harness')`);
		return;
	}
	if (await os.has("zenity")) await os.run("zenity", ["--error", "--title=Harness", `--text=${message}`]);
	else if (await os.has("kdialog")) await os.run("kdialog", ["--title", "Harness", "--error", message]);
}
