import path from "path";
import simpleGit from "simple-git";
import { diffLines } from "diff";

const filePath = `D:/Repos/PassiveMonCore/sources/dev/PassiveWebApp/src/PassiveWebApp/MdsConfigValidationTest/MdsConfigValidatorTest.cs`;

async function getFileChangeHistory(
    filePath: string,
    range?: { start: number; end: number }
) {
    const git = simpleGit(path.dirname(filePath));
    const basePath = await git.revparse(["--show-toplevel"]);

    const relativePath = path
        .relative(basePath, filePath)
        .replaceAll("\\", "/");

    // Get the latest commit that modified the file
    const commit = await git
        .log({
            file: filePath,
            maxCount: 1,
        })
        .then((r) => r.latest);
    if (!commit) {
        return null;
    }

    // Get the file's content before and after the commit
    const beforeContent = await git.show([`${commit.hash}~1:${relativePath}`]);
    const afterContent = await git.show([`${commit.hash}:${relativePath}`]);

    if (!range) {
        range = { start: 1, end: afterContent.split("\n").length };
    }
    const beforeRange = { ...range };

    let currentLine = 0;

    // Compute the line range in the beforeContent that corresponds to the given range in afterContent
    for (const diff of diffLines(afterContent, beforeContent)) {
        if (diff.added) {
            if (currentLine < beforeRange.start) {
                beforeRange.start += diff.count;
                beforeRange.end += diff.count;
            } else if (currentLine < beforeRange.end) {
                beforeRange.end += diff.count;
            }
        } else if (diff.removed) {
            if (currentLine < beforeRange.start) {
                beforeRange.start -= diff.count;
                beforeRange.end -= diff.count;
            } else if (currentLine < beforeRange.end) {
                beforeRange.end -= Math.min(
                    diff.count,
                    beforeRange.end - currentLine
                );
            }
        }
        currentLine += diff.count;
    }

    return {
        before: sliceLine(
            beforeContent,
            beforeRange.start - 1,
            beforeRange.end
        ),
        after: sliceLine(afterContent, range.start - 1, range.end),
        beforeRange: beforeRange,
    };
}

function sliceLine(text: string, start?: number, end?: number) {
    const lines = text.split("\n");
    const slicedLines = lines.slice(start ?? 0, end ?? lines.length);
    return slicedLines.join("\n");
}

getFileChangeHistory(filePath, {
    start: 136,
    end: 165,
})
    .then((res) => {
        console.log("before:");
        console.log(res?.before);
        console.log("after:");
        console.log(res?.after);
        console.log(res?.beforeRange);
    })
    .then(() => {
        console.log("expected", {
            start: 137,
            end: 162,
        });
    });
