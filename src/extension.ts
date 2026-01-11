// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import path from "path";
import simpleGit from "simple-git";
import * as vscode from "vscode";
import { diffLines } from "diff";
import { inspect } from "util";
import { tmpdir } from "os";
import { mkdir } from "fs/promises";

let outputChannel: vscode.OutputChannel;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "funky-code.nextSelectionHistory",
            async () => {
                await vscode.commands.executeCommand(
                    "workbench.action.compareEditor.focusPrimarySide"
                );
                const { range, filePath, commit } = parseFromDiffContextLines();
                await showSelectionGitHistory(filePath!, {
                    range,
                    fromAfter: commit!,
                });
            }
        ),
        vscode.commands.registerCommand(
            "funky-code.prevSelectionHistory",
            async () => {
                await vscode.commands.executeCommand(
                    "workbench.action.compareEditor.focusSecondarySide"
                );
                const { range, filePath, commit } = parseFromDiffContextLines();
                await showSelectionGitHistory(filePath!, {
                    range,
                    toBefore: commit!,
                });
            }
        )
    );

    // Create output channel
    outputChannel = vscode.window.createOutputChannel("Funky Code");
    context.subscriptions.push(outputChannel);

    outputChannel.show();
    vscode.commands.executeCommand("workbench.action.closeAllEditors");
    showSelectionGitHistory(
        `D:/Repos/PassiveMonCore/sources/dev/PassiveWebApp/src/PassiveWebApp/MdsConfigValidationTest/MdsConfigValidatorTest.cs`,
        {
            range: {
                start: 27,
                end: 53,
            },
        }
    ).catch(logToFunkyCode);
}

function logToFunkyCode(...messages: any[]) {
    for (const message of messages) {
        outputChannel?.appendLine(
            typeof message === "string" ? message : inspect(message)
        );
    }
}

function parseFromDiffContextLines() {
    const diffDoc = vscode.window.activeTextEditor!.document;
    const diffText = diffDoc.getText();
    const lines = diffText.split("\n");

    const range = {
        start: 6699,
        end: 6699,
    };
    let filePath = null;
    let commit = null;

    for (const line of lines) {
        if (line.startsWith("// file path: ")) {
            filePath = line.substring("// file path: ".length).trim();
        } else if (line.startsWith("// start line: ")) {
            const startLine = parseInt(
                line.substring("// start line: ".length).trim()
            );
            range.start = startLine;
        } else if (line.startsWith("// end line: ")) {
            const endLine = parseInt(
                line.substring("// end line: ".length).trim()
            );
            range.end = endLine;
        } else if (line.startsWith("// commit: ")) {
            commit = line.substring("// commit: ".length).trim();
        }
    }

    return {
        filePath,
        range,
        commit,
    };
}

async function showSelectionGitHistory(
    filePath: string,
    opts: {
        range?: { start: number; end: number };
        fromAfter?: string;
        toBefore?: string;
    }
) {
    logToFunkyCode(arguments);

    const change = await getFileChangeHistory(
        filePath,
        opts.fromAfter,
        opts.toBefore,
        opts.range
    ).catch(logToFunkyCode);
    const { before, after, ...rest } = change || {};
    logToFunkyCode("change:", rest);

    if (!change) {
        vscode.window.showInformationMessage(
            "No git history found for selection."
        );
        return;
    }

    const tmpDir = tmpdir() + "/funky-code";
    await mkdir(tmpDir, { recursive: true });
    const extension = path.extname(filePath);
    const beforePath = `${tmpDir}/before${extension}`;
    const afterPath = `${tmpDir}/after${extension}`;

    const beforeUri = vscode.Uri.file(beforePath);
    const afterUri = vscode.Uri.file(afterPath);

    const contextLines = [
        `// file path: ${filePath}`,
        `// commit: ${change.commit}`,
        `// author: ${change.author}`,
        `// author email: ${change.authorEmail}`,
    ];
    const beforeContext =
        [
            ...contextLines,
            `// start line: ${change.beforeRange.start}`,
            `// end line: ${change.beforeRange.end}`,
        ].join("\n") + "\n\n";
    const afterContext =
        [
            ...contextLines,
            `// start line: ${change.afterRange.start}`,
            `// end line: ${change.afterRange.end}`,
        ].join("\n") + "\n\n";

    await vscode.workspace.fs.writeFile(
        beforeUri,
        Buffer.from(beforeContext + change.before, "utf-8")
    );
    await vscode.workspace.fs.writeFile(
        afterUri,
        Buffer.from(afterContext + change.after, "utf-8")
    );

    await vscode.commands.executeCommand(
        "vscode.diff",
        beforeUri,
        afterUri,
        `Git Change History: ${path.basename(filePath)}`
    );
}

async function getFileChangeHistory(
    filePath: string,
    fromAfterCommit?: string,
    toBeforeCommit?: string,
    range?: { start: number; end: number }
) {
    const git = simpleGit(path.dirname(filePath));
    const basePath = await git.revparse(["--show-toplevel"]);
    const firstCommit = await git.firstCommit();
    const direction = fromAfterCommit ? "newer" : "older";

    const relativePath = path
        .relative(basePath, filePath)
        .replaceAll("\\", "/");

    const allCommits = await git
        .log({
            file: filePath,
            from: fromAfterCommit ?? firstCommit,
            to: toBeforeCommit ?? "HEAD",
        })
        .then((r) =>
            r.all.filter(
                (c) => c.hash !== fromAfterCommit && c.hash !== toBeforeCommit
            )
        );

    let changedRange = null;

    // Find until we find a commit that changes the given range
    while (allCommits.length > 0) {
        const currentCommit =
            direction === "older" ? allCommits.shift()! : allCommits.pop()!;
        const hash = currentCommit.hash;
        logToFunkyCode(`Checking commit: ${hash}`);

        // Get the file's content before and after the commit
        // Note that if this is the first commit, there is no "before" content since the file is added
        let changedContent = "";
        let currentContent = "";
        if (direction === "older") {
            if (allCommits.length > 0) {
                changedContent = await git.show([`${hash}~1:${relativePath}`]);
            }
            currentContent = await git.show([`${hash}:${relativePath}`]);
        } else {
            currentContent = await git.show([`${hash}~1:${relativePath}`]);
            changedContent = await git.show([`${hash}:${relativePath}`]);
        }

        if (!range) {
            range = { start: 1, end: currentContent.split("\n").length };
        }
        if (!changedRange) {
            changedRange = { ...range };
        }

        let currentLine = 1;
        let changed = false;

        // Compute the line range in the beforeContent that corresponds to the given range in afterContent
        for (const diff of diffLines(currentContent, changedContent)) {
            if (diff.added) {
                if (currentLine < changedRange.start) {
                    changedRange.start += diff.count;
                    changedRange.end += diff.count;
                } else if (currentLine <= changedRange.end) {
                    changed = true;
                    changedRange.end += diff.count;
                }
            } else if (diff.removed) {
                if (currentLine < changedRange.start) {
                    changedRange.start -= diff.count;
                    changedRange.end -= diff.count;
                } else if (currentLine < changedRange.end) {
                    changed = true;
                    changedRange.end = Math.max(
                        changedRange.end - diff.count,
                        currentLine
                    );
                }
            }
            // logToFunkyCode({
            //     currentLine,
            //     range,
            //     beforeRange,
            //     diff: {
            //         mod: diff.added
            //             ? "added"
            //             : diff.removed
            //             ? "removed"
            //             : "unchanged",
            //         count: diff.count,
            //     },
            // });

            if (!diff.removed) {
                currentLine += diff.count;
            }
        }

        if (changed) {
            return {
                before: sliceLine(
                    changedContent,
                    changedRange.start - 1,
                    changedRange.end
                ),
                beforeRange: direction === "older" ? changedRange : range,
                after: sliceLine(currentContent, range.start - 1, range.end),
                afterRange: direction === "older" ? range : changedRange,
                commit: currentCommit.hash,
                author: currentCommit.author_name,
                authorEmail: currentCommit.author_email,
            };
        }
    }

    return null;
}

function sliceLine(text: string, start?: number, end?: number) {
    const lines = text.split("\n");
    const slicedLines = lines.slice(start ?? 0, end ?? lines.length);
    return slicedLines.join("\n");
}

// This method is called when your extension is deactivated
export function deactivate() {}
