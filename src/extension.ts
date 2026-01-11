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
            () => {}
        ),
        vscode.commands.registerCommand(
            "funky-code.prevSelectionHistory",
            () => {}
        )
    );

    // Create output channel
    outputChannel = vscode.window.createOutputChannel("Funky Code");
    context.subscriptions.push(outputChannel);

    outputChannel.show();
    vscode.commands.executeCommand("workbench.action.closeAllEditors");
    showSelectionGitHistory(
        `D:/Repos/PassiveMonCore/sources/dev/PassiveWebApp/src/PassiveWebApp/MdsConfigValidationTest/MdsConfigValidatorTest.cs`,
        new vscode.Range(
            new vscode.Position(25, 0),
            new vscode.Position(93, 10)
        )
    ).catch(logToFunkyCode);
}

function logToFunkyCode(...messages: any[]) {
    for (const message of messages) {
        outputChannel?.appendLine(
            typeof message === "string" ? message : inspect(message)
        );
    }
}

async function showSelectionGitHistory(filePath: string, range?: vscode.Range) {
    const change = await getFileChangeHistory(
        filePath,
        undefined,
        range
            ? {
                  start: range.start.line,
                  end: range.end.line,
              }
            : undefined
    ).catch(logToFunkyCode);
    logToFunkyCode("change:", change?.beforeRange);

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
    excludeCommitFrom?: string,
    range?: { start: number; end: number }
) {
    const git = simpleGit(path.dirname(filePath));
    const basePath = await git.revparse(["--show-toplevel"]);
    const firstCommit = await git.firstCommit();

    const relativePath = path
        .relative(basePath, filePath)
        .replaceAll("\\", "/");

    const allCommits = await git
        .log({
            file: filePath,
            from: firstCommit,
            to: excludeCommitFrom ? `${excludeCommitFrom}~1` : undefined,
        })
        .then((r) => [...r.all]);

    // Find until we find a commit that changes the given range
    while (allCommits.length > 0) {
        const currentCommit = allCommits.shift()!;
        const hash = currentCommit.hash;
        logToFunkyCode(`Checking commit: ${hash}`);

        // Get the file's content before and after the commit
        // Note that if this is the first commit, there is no "before" content since the file is added
        const beforeContent =
            allCommits.length > 0
                ? await git.show([`${hash}~1:${relativePath}`])
                : "";
        const afterContent = await git.show([`${hash}:${relativePath}`]);

        if (!range) {
            range = { start: 1, end: afterContent.split("\n").length };
        }
        const beforeRange = { ...range };

        let currentLine = 1;
        let changed = false;

        // Compute the line range in the beforeContent that corresponds to the given range in afterContent
        for (const diff of diffLines(afterContent, beforeContent)) {
            if (diff.added) {
                if (currentLine < beforeRange.start) {
                    beforeRange.start += diff.count;
                    beforeRange.end += diff.count;
                } else if (currentLine < beforeRange.end) {
                    changed = true;
                    beforeRange.end += diff.count;
                }
            } else if (diff.removed) {
                if (currentLine < beforeRange.start) {
                    beforeRange.start -= diff.count;
                    beforeRange.end -= diff.count;
                } else if (currentLine < beforeRange.end) {
                    changed = true;
                    beforeRange.end -= Math.min(
                        diff.count,
                        beforeRange.end - currentLine
                    );
                }
            }

            currentLine += diff.count;
        }

        if (changed) {
            return {
                before: sliceLine(
                    beforeContent,
                    beforeRange.start - 1,
                    beforeRange.end
                ),
                after: sliceLine(afterContent, range.start - 1, range.end),
                beforeRange: beforeRange,
                afterRange: range,
                commit: currentCommit.hash,
                author: currentCommit.author_name,
                authorEmail: currentCommit.author_email,
            };
        }
    }
}

function sliceLine(text: string, start?: number, end?: number) {
    const lines = text.split("\n");
    const slicedLines = lines.slice(start ?? 0, end ?? lines.length);
    return slicedLines.join("\n");
}

// This method is called when your extension is deactivated
export function deactivate() {}
