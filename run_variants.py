import json
import pathlib
import datetime
from simulate import simulate


ROOT = pathlib.Path(__file__).resolve().parent
BOARDS_DIR = ROOT / "data" / "boards"
REPORT_PATH = ROOT / "reports" / "simulation_report.md"


def main() -> None:
    games = 50000
    seed = 7
    player_counts = [1, 2, 3, 4]

    today = datetime.date.today().strftime("%B %d, %Y")

    lines = []
    lines.append(f"# Simulation Report ({today})")
    lines.append("")
    lines.append(f"Runs: {games:,} games per variant, fixed seed {seed}.")
    lines.append("")
    lines.append("Assumptions: Decks reshuffle when they run out. Game ends when any player reaches the end.")
    lines.append("")

    for path in sorted(BOARDS_DIR.glob("*.json")):
        with path.open("r", encoding="utf-8") as f:
            spec = json.load(f)

        variant_name = spec.get("name", path.stem)
        lines.append(f"## {variant_name}")
        lines.append("")
        lines.append(f"JSON: `{path.name}`")
        lines.append("")

        for players in player_counts:
            stats = simulate(spec, games=games, seed=seed, players=players)
            lines.append(f"### Players: {players}")
            lines.append("")
            lines.append(
                "| Seat | Win % | Avg Turns | Turns Std Dev | Turns P50 | Turns P90 | Avg Good Draws | Avg Bad Draws | Avg Total Draws | Total Draws Std Dev | Total Draws P50 | Total Draws P90 |"
            )
            lines.append(
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"
            )

            for idx, pdata in enumerate(stats["per_player"], start=1):
                lines.append(
                    "| Player {idx} | {win_rate:.1f}% | {avg_turns:.2f} | {turns_sd:.2f} | {turns_p50} | {turns_p90} | {avg_good:.2f} | {avg_bad:.2f} | {avg_total:.2f} | {total_sd:.2f} | {total_p50} | {total_p90} |".format(
                        idx=idx,
                        win_rate=pdata["win_rate"] * 100,
                        avg_turns=pdata["avg_turns"],
                        turns_sd=pdata["turns_stdev"],
                        turns_p50=pdata["turns_p50"],
                        turns_p90=pdata["turns_p90"],
                        avg_good=pdata["avg_good_draws"],
                        avg_bad=pdata["avg_bad_draws"],
                        avg_total=pdata["avg_total_draws"],
                        total_sd=pdata["total_draws_stdev"],
                        total_p50=pdata["total_draws_p50"],
                        total_p90=pdata["total_draws_p90"],
                    )
                )

            lines.append("")

    REPORT_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
