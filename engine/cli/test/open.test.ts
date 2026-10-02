import { beforeEach, describe, expect, it, vi } from "vitest";
import { openLink, parseLink } from "../src/commands/open.js";
import { composed } from "./preflight/support.js";
import { fakeShell } from "./os/support.js";

const load = async () => composed();
const printed = (): string[] => vi.mocked(console.log).mock.calls.map((call) => String(call[0]));
const errored = (): string[] => vi.mocked(console.error).mock.calls.map((call) => String(call[0]));
const STARTER = "/tmp/harness-open-x/harness-run.command";

beforeEach(() => {
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	vi.mocked(console.log).mockClear();
	vi.mocked(console.error).mockClear();
});

/** §11.24 (W5-D13): what a link does, and what it refuses to do. */
describe("harness open (W5-D13)", () => {
	it("open_refuses_anything_that_is_not_a_harness_link", async () => {
		for (const bad of [undefined, "", "https://example.com/run?harness=h1&provider=claude", "harness://x?harness=h1&provider=claude", "harness://run?harness=h1", "harness://run?provider=claude"]) {
			expect(() => parseLink(bad)).toThrow();
		}
		// A relative workspace would resolve against whatever directory the OS
		// launched us in, which is nobody's choice.
		expect(() => parseLink("harness://run?harness=h1&provider=claude&workspace=notes")).toThrow();
		expect(parseLink("harness://run?harness=h1&provider=claude")).toEqual({ harness: "h1", provider: "claude", workspace: undefined });

		const os = fakeShell("darwin");
		expect(await openLink("https://example.com", load, os)).toBe(1);
		// There is no terminal yet, so the refusal is a window as well as a line.
		expect(os.calls[0].file).toBe("osascript");
		expect(os.calls[0].args[1]).toContain("display dialog");
		expect(errored()[0]).toContain("is not a link this CLI understands");
	});

	it("open_refuses_a_harness_or_a_runtime_the_person_does_not_have", async () => {
		const os = fakeShell("darwin");
		expect(await openLink("harness://run?harness=gone&provider=claude", load, os)).toBe(1);
		expect(errored()[0]).toContain("No harness called `gone`");
		// Nothing was started: the only process was the dialog.
		expect(os.calls.map((call) => call.file)).toEqual(["osascript"]);

		vi.mocked(console.error).mockClear();
		expect(await openLink("harness://run?harness=h1&provider=cursor", load, fakeShell("darwin"))).toBe(1);
		expect(errored()[0]).toContain('"cursor" is not a provider this CLI knows');
	});

	it("open_with_a_workspace_asks_nothing_and_opens_a_terminal_there", async () => {
		const os = fakeShell("darwin");
		os.directories.add("/Users/dana/projects/foo");
		expect(await openLink("harness://run?harness=h1&provider=claude&workspace=/Users/dana/projects/foo", load, os)).toBe(0);
		// No picker at all — the link already said where.
		expect(os.calls.map((call) => call.file)).toEqual(["open"]);
		expect(os.calls[0].args).toEqual(["-a", "Terminal", STARTER]);
		expect(os.files[STARTER]).toEqual({
			body: "#!/bin/sh\ncd '/Users/dana/projects/foo' || exit 1\nexec '/opt/node/bin/node' '/opt/harness/dist/cli.js' run claude --harness h1\n",
			mode: 0o700,
		});
		expect(printed()[0]).toBe("Opening Support in /Users/dana/projects/foo.");
	});

	it("open_refuses_a_workspace_that_is_no_longer_there", async () => {
		const os = fakeShell("darwin");
		expect(await openLink("harness://run?harness=h1&provider=claude&workspace=/Users/dana/gone", load, os)).toBe(1);
		expect(errored()[0]).toBe("There is no folder at /Users/dana/gone on this machine any more.");
	});

	it("open_asks_for_an_existing_folder_and_runs_there", async () => {
		const os = fakeShell("darwin");
		os.answers = [{ stdout: "button returned:Open an existing folder\n" }, { stdout: "/Users/dana/projects/foo/\n" }];
		expect(await openLink("harness://run?harness=h1&provider=claude", load, os)).toBe(0);
		expect(os.calls[0].args[1]).toContain('buttons {"Cancel", "Create a new workspace", "Open an existing folder"}');
		expect(os.calls[1].args[1]).toBe('POSIX path of (choose folder with prompt "Choose the folder this session should run in")');
		// `choose folder` answers with a trailing separator; the script must not.
		expect(os.files[STARTER].body).toContain("cd '/Users/dana/projects/foo' || exit 1");
		expect(os.made).toEqual([]); // an existing folder is not made again
	});

	it("open_makes_the_new_workspace_it_was_asked_for", async () => {
		const os = fakeShell("darwin");
		os.answers = [{ stdout: "button returned:Create a new workspace\n" }, { stdout: "/Users/dana/projects/\n" }, { stdout: "newsletter\n" }];
		expect(await openLink("harness://run?harness=h1&provider=claude", load, os)).toBe(0);
		expect(os.calls[1].args[1]).toContain("Choose where the new workspace should go");
		expect(os.calls[2].args[1]).toContain("Name the new workspace");
		expect(os.made).toEqual(["/Users/dana/projects/newsletter"]);
		expect(os.files[STARTER].body).toContain("cd '/Users/dana/projects/newsletter' || exit 1");
	});

	it("open_treats_a_closed_dialog_as_a_cancel_and_not_a_failure", async () => {
		const os = fakeShell("darwin");
		// osascript exits non-zero when the person hits Cancel; that exit is
		// the answer, not a fault.
		os.answers = [{ code: 1 }];
		expect(await openLink("harness://run?harness=h1&provider=claude", load, os)).toBe(0);
		expect(printed()).toEqual(["Nothing was chosen, so no session was started."]);
		expect(os.calls).toHaveLength(1);
	});

	it("open_prints_the_command_when_the_machine_can_draw_no_dialog", async () => {
		const os = fakeShell("linux"); // no zenity, no kdialog
		expect(await openLink("harness://run?harness=h1&provider=claude", load, os)).toBe(1);
		expect(errored()[1]).toContain("harness run claude --harness h1");
		expect(os.calls).toEqual([]);
	});

	it("open_on_windows_and_linux_uses_that_platform's_picker_and_terminal", async () => {
		const win = fakeShell("win32");
		win.present.add("wt");
		win.answers = [{ stdout: "Yes\n" }, { stdout: "C:\\Users\\dana\\projects\\foo\n" }];
		expect(await openLink("harness://run?harness=h1&provider=claude", load, win)).toBe(0);
		expect(win.calls[0].args[3]).toContain("MessageBox");
		expect(win.calls[1].args[3]).toContain("FolderBrowserDialog");
		expect(win.calls[2]).toEqual({
			file: "wt",
			args: ["-d", "C:\\Users\\dana\\projects\\foo", "C:\\Program Files\\nodejs\\node.exe", "C:\\harness\\dist\\cli.js", "run", "claude", "--harness", "h1"],
		});

		const lin = fakeShell("linux");
		lin.present.add("zenity");
		lin.present.add("x-terminal-emulator");
		lin.answers = [{ stdout: "", code: 0 }, { stdout: "/home/dana/projects/foo\n" }];
		expect(await openLink("harness://run?harness=h1&provider=claude", load, lin)).toBe(0);
		expect(lin.calls[0]).toEqual({
			file: "zenity",
			args: ["--question", "--title=Harness", "--text=Where should this session run?", "--ok-label=Open an existing folder", "--cancel-label=Cancel", "--extra-button=Create a new workspace"],
		});
		expect(lin.calls[1]).toEqual({ file: "zenity", args: ["--file-selection", "--directory", "--title=Choose the folder this session should run in"] });
		expect(lin.calls[2]).toEqual({ file: "x-terminal-emulator", args: ["-e", "/tmp/harness-open-x/harness-run.sh"] });
	});
});
