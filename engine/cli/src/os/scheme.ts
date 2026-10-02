import { join } from "node:path";
import { appleString, type Shell, word } from "./shell.js";

/**
 * W5-D13 — the `harness://` link type, registered per operating system behind
 * one pair of functions. A console card is a link, not a listener: nothing
 * runs on the machine waiting for the browser, and the OS hands the URL to
 * the CLI the way it hands a `vscode://` link to VS Code.
 *
 * Every per-OS detail lives here. The rest of the CLI knows two verbs.
 */

export const APP_NAME = "Harness.app";
export const BUNDLE_ID = "co.harness.cli";
export const DESKTOP_FILE = "harness.desktop";
export const KEY = "HKCU\\Software\\Classes\\harness";
const LSREGISTER =
	"/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
const URL_TYPES = JSON.stringify([{ CFBundleURLName: "Harness", CFBundleURLSchemes: ["harness"] }]);

export const appPath = (os: Shell): string => join(os.home, "Applications", APP_NAME);
export const desktopDir = (os: Shell): string => join(os.home, ".local", "share", "applications");
export const desktopPath = (os: Shell): string => join(desktopDir(os), DESKTOP_FILE);

/** How the handler calls us back. Never `harness`: a handler the OS launches
    inherits none of the person's PATH, so the interpreter and the script are
    both absolute (the reasoning is on `Shell.node`). */
export const invocation = (os: Shell): string => `${word(os.node)} ${word(os.script)}`;

/** macOS delivers a URL to an application as an Apple Event, never as an
    argument, so the handler has to be an application. This is the smallest
    one that exists: an AppleScript applet with an `on open location`. */
export function applet(os: Shell): string {
	return `on open location theURL\n\tdo shell script "${appleString(invocation(os))} open " & quoted form of theURL\nend open location\n`;
}

export function desktopEntry(os: Shell): string {
	return [
		"[Desktop Entry]",
		"Type=Application",
		"Name=Harness",
		"Comment=Open a harness session from the console",
		`Exec=${os.node} ${os.script} open %u`,
		"Terminal=false",
		"NoDisplay=true",
		"MimeType=x-scheme-handler/harness;",
		"",
	].join("\n");
}

/**
 * Registers `harness://` for the person who ran it — never machine-wide, so
 * nothing here needs a password.
 */
export async function registerScheme(os: Shell): Promise<string[]> {
	if (os.platform === "darwin") {
		const app = appPath(os);
		const tmp = await os.tmp();
		const source = join(tmp, "harness-url.applescript");
		await os.write(source, applet(os), 0o600);
		await os.mkdir(join(os.home, "Applications"));
		// `osacompile` writes a bundle; an older one in the way is replaced.
		await os.rm(app);
		await os.run("osacompile", ["-o", app, source]);
		const plist = join(app, "Contents", "Info.plist");
		await os.run("plutil", ["-replace", "CFBundleIdentifier", "-string", BUNDLE_ID, plist]);
		await os.run("plutil", ["-replace", "CFBundleURLTypes", "-json", URL_TYPES, plist]);
		await os.run(LSREGISTER, ["-f", app]);
		await os.rm(tmp);
		return [`\`harness://\` links open this machine's harness: ${app}.`];
	}
	if (os.platform === "win32") {
		await os.run("reg", ["add", KEY, "/ve", "/d", "URL:Harness", "/f"]);
		await os.run("reg", ["add", KEY, "/v", "URL Protocol", "/t", "REG_SZ", "/d", "", "/f"]);
		await os.run("reg", ["add", `${KEY}\\shell\\open\\command`, "/ve", "/d", `"${os.node}" "${os.script}" open "%1"`, "/f"]);
		return [`\`harness://\` links open this machine's harness: ${KEY}.`];
	}
	await os.mkdir(desktopDir(os));
	await os.write(desktopPath(os), desktopEntry(os), 0o644);
	await os.run("xdg-mime", ["default", DESKTOP_FILE, "x-scheme-handler/harness"]);
	if (await os.has("update-desktop-database")) await os.run("update-desktop-database", [desktopDir(os)]);
	return [`\`harness://\` links open this machine's harness: ${desktopPath(os)}.`];
}

/** The inverse, and safe to run on a machine that was never registered. */
export async function unregisterScheme(os: Shell): Promise<string[]> {
	if (os.platform === "darwin") {
		const app = appPath(os);
		await os.run(LSREGISTER, ["-u", app]);
		await os.rm(app);
		return [`\`harness://\` links no longer open on this machine; ${app} is gone.`];
	}
	if (os.platform === "win32") {
		await os.run("reg", ["delete", KEY, "/f"]);
		return ["`harness://` links no longer open on this machine."];
	}
	await os.rm(desktopPath(os));
	if (await os.has("update-desktop-database")) await os.run("update-desktop-database", [desktopDir(os)]);
	return ["`harness://` links no longer open on this machine."];
}
