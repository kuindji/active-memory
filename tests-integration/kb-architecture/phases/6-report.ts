import type { ScoresData, ReportData, ReportRow, IngestedData } from "../types.js";
import {
    readCheckpoint,
    writeCheckpoint,
    hasCheckpoint,
    listConfigCheckpoints,
} from "../checkpoint.js";

function buildRow(configName: string): ReportRow | null {
    if (!hasCheckpoint(configName, 5)) return null;

    const scores = readCheckpoint<ScoresData>(configName, 5);
    const ingestMs = hasCheckpoint(configName, 1)
        ? readCheckpoint<IngestedData>(configName, 1).durationMs
        : 0;
    const processMs = hasCheckpoint(configName, 2) ? readCheckpoint(configName, 2).durationMs : 0;
    const consolidateMs = hasCheckpoint(configName, 3)
        ? readCheckpoint(configName, 3).durationMs
        : 0;

    return {
        config: configName,
        avgScore: scores.data.avgScore,
        avgTime: scores.data.avgTime,
        qualityPerSecond: scores.data.qualityPerSecond,
        contextRelevance: scores.data.contextRelevance,
        contextNoise: scores.data.contextNoise,
        supersessionAccuracy: scores.data.supersessionAccuracy,
        classificationAccuracy: scores.data.classificationAccuracy,
        ingestTimeMs: ingestMs + processMs + consolidateMs,
    };
}

export function runReport(): ReportData {
    console.log("\n[Phase 6: Report] Generating comparative report...\n");

    const configNames = listConfigCheckpoints();
    const rows: ReportRow[] = [];
    let baseline: ReportRow | null = null;

    for (const name of configNames) {
        const row = buildRow(name);
        if (!row) continue;

        if (name === "baseline-no-kb") {
            baseline = row;
        } else {
            rows.push(row);
        }
    }

    if (!baseline) {
        baseline = {
            config: "baseline-no-kb",
            avgScore: 0,
            avgTime: 0,
            qualityPerSecond: 0,
            contextRelevance: 0,
            contextNoise: 0,
            supersessionAccuracy: 0,
            classificationAccuracy: 0,
            ingestTimeMs: 0,
        };
        console.warn("[Report] No baseline found — using zeros");
    }

    rows.sort((a, b) => b.qualityPerSecond - a.qualityPerSecond);

    console.log(
        "| Config | AvgScore | AvgTime(s) | Q/s | Relevance | Noise | Supersession | Classification | IngestTime(s) |",
    );
    console.log(
        "|--------|----------|------------|-----|-----------|-------|--------------|----------------|---------------|",
    );

    const printRow = (r: ReportRow) => {
        console.log(
            `| ${r.config.padEnd(45)} | ${r.avgScore.toFixed(2).padStart(8)} | ${r.avgTime.toFixed(1).padStart(10)} | ${r.qualityPerSecond.toFixed(3).padStart(5)} | ${(r.contextRelevance * 100).toFixed(0).padStart(8)}% | ${(r.contextNoise * 100).toFixed(0).padStart(4)}% | ${(r.supersessionAccuracy * 100).toFixed(0).padStart(11)}% | ${(r.classificationAccuracy * 100).toFixed(0).padStart(13)}% | ${(r.ingestTimeMs / 1000).toFixed(1).padStart(13)} |`,
        );
    };

    printRow(baseline);
    for (const row of rows) {
        printRow(row);
    }

    const recommendations: string[] = [];

    if (rows.length > 0) {
        const best = rows[0];
        recommendations.push(
            `Best quality/speed tradeoff: "${best.config}" (Q/s: ${best.qualityPerSecond.toFixed(3)})`,
        );

        const bestQuality = [...rows].sort((a, b) => b.avgScore - a.avgScore)[0];
        if (bestQuality.config !== best.config) {
            recommendations.push(
                `Highest quality: "${bestQuality.config}" (score: ${bestQuality.avgScore.toFixed(2)})`,
            );
        }

        const bestSpeed = [...rows].sort((a, b) => a.avgTime - b.avgTime)[0];
        if (bestSpeed.config !== best.config) {
            recommendations.push(
                `Fastest: "${bestSpeed.config}" (${bestSpeed.avgTime.toFixed(1)}s avg)`,
            );
        }

        const belowBaseline = rows.filter((r) => r.avgScore <= baseline.avgScore);
        if (belowBaseline.length > 0) {
            recommendations.push(
                `Configs at or below baseline (remove): ${belowBaseline.map((r) => r.config).join(", ")}`,
            );
        }
    }

    console.log("\nRecommendations:");
    for (const rec of recommendations) {
        console.log(`  - ${rec}`);
    }

    const data: ReportData = { baseline, configs: rows, recommendations };
    writeCheckpoint("_report", 6, data, 0);

    return data;
}

if (import.meta.main) {
    runReport();
}
