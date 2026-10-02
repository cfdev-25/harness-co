/*
 * The sandbox probe binary (06 §8.2). Its entire behaviour is to say hello and
 * exit 0. It exists to be *refused*: probe 3 execs it from <sessionDir>/denied,
 * which Spike 5 (docs/sandbox-notes.md) showed `deny file-read*` alone does not
 * stop for a compiled Mach-O — only `deny process-exec` does. A copied system
 * binary cannot stand in: macOS's trust cache SIGKILLs one before the sandbox
 * is consulted, which is a confound, not a result. So the binary is ours.
 */
#include <unistd.h>

int main(void) {
	write(1, "hello\n", 6);
	return 0;
}
