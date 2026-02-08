import argparse
import json
import math
import random
from dataclasses import dataclass
from typing import Any, Dict, List, Tuple


def roll_d6(rng: random.Random) -> int:
    return rng.randint(1, 6)


@dataclass
class Card:
    card_id: str
    params: Dict[str, Any]


class Deck:
    def __init__(self, cards: List[Card], rng: random.Random) -> None:
        self._cards = cards
        self._rng = rng
        self._index = 0

    @classmethod
    def from_spec(cls, spec: Dict[str, Any], rng: random.Random) -> "Deck":
        cards: List[Card] = []
        pinned: List[Card] = []
        for card_spec in spec["cards"]:
            count = int(card_spec.get("count", 1))
            card_id = card_spec["id"]
            params = card_spec.get("params", {})
            pin_last = bool(card_spec.get("pin_last", False))
            for _ in range(count):
                card = Card(card_id=card_id, params=params)
                if pin_last:
                    pinned.append(card)
                else:
                    cards.append(card)
        rng.shuffle(cards)
        cards.extend(pinned)
        return cls(cards=cards, rng=rng)

    def draw(self) -> Card:
        if not self._cards:
            raise ValueError("Deck is empty")
        card = self._cards[self._index]
        self._index += 1
        if self._index >= len(self._cards):
            self._index = 0
            self._rng.shuffle(self._cards)
        return card


def resolve_card(
    card: Card,
    position: int,
    end_index: int,
    spaces: List[str],
    rng: random.Random,
    state: Dict[str, Any],
) -> Tuple[int, Dict[str, Any]]:
    card_id = card.card_id
    params = card.params

    if card_id == "go_back":
        if "steps" not in params:
            raise ValueError("go_back requires params.steps")
        delta = int(params["steps"])
        position = max(0, position - delta)
    elif card_id == "go_to_start":
        position = 0
    elif card_id == "roll_back":
        position = max(0, position - roll_d6(rng))
    elif card_id == "lose_turn":
        state["skip_next"] = True
    elif card_id == "counter_next_bad":
        state["counter_bad"] = True
    elif card_id == "roll_forward":
        position = min(end_index, position + roll_d6(rng))
    elif card_id == "extra_turn":
        state["extra_turn"] = True
    elif card_id == "jump_forward":
        if "steps" in params:
            delta = int(params["steps"])
        else:
            delta = rng.randint(int(params.get("min", 1)), int(params.get("max", 3)))
        position = min(end_index, position + delta)
    elif card_id == "jump_next_neutral":
        idx = position + 1
        while idx < end_index and spaces[idx] != "neutral":
            idx += 1
        position = min(end_index, idx)
    elif card_id == "go_to_end":
        position = end_index
    else:
        raise ValueError(f"Unknown card id: {card_id}")

    return position, state


def simulate_game(spec: Dict[str, Any], rng: random.Random, players: int = 1) -> Dict[str, Any]:
    spaces = spec["board"]["spaces"]
    end_index = len(spaces) - 1

    if spaces[0] != "start" or spaces[-1] != "end":
        raise ValueError("Board must start with 'start' and end with 'end'")

    good_deck = Deck.from_spec(spec["good_deck"], rng)
    bad_deck = Deck.from_spec(spec["bad_deck"], rng)

    positions = [0 for _ in range(players)]
    turns_taken = [0 for _ in range(players)]
    good_draws = [0 for _ in range(players)]
    bad_draws = [0 for _ in range(players)]
    states = [{"skip_next": False, "counter_bad": False, "extra_turn": False} for _ in range(players)]

    current = 0
    winner = None

    while winner is None:
        state = states[current]
        turns_taken[current] += 1

        if state["skip_next"]:
            state["skip_next"] = False
        else:
            roll = roll_d6(rng)
            positions[current] = min(end_index, positions[current] + roll)
            if positions[current] >= end_index:
                winner = current
                break

            space = spaces[positions[current]]
            if space == "good":
                card = good_deck.draw()
                good_draws[current] += 1
                positions[current], state = resolve_card(
                    card, positions[current], end_index, spaces, rng, state
                )
            elif space == "bad":
                if state["counter_bad"]:
                    state["counter_bad"] = False
                else:
                    card = bad_deck.draw()
                    bad_draws[current] += 1
                    positions[current], state = resolve_card(
                        card, positions[current], end_index, spaces, rng, state
                    )

            if positions[current] >= end_index:
                winner = current
                break

        if state["extra_turn"]:
            state["extra_turn"] = False
            turns_taken[current] -= 1
            continue

        current = (current + 1) % players

    return {
        "turns": turns_taken,
        "good_draws": good_draws,
        "bad_draws": bad_draws,
        "winner": winner,
    }


def simulate(spec: Dict[str, Any], games: int, seed: int, players: int = 1) -> Dict[str, Any]:
    rng = random.Random(seed)
    results = [simulate_game(spec, rng, players=players) for _ in range(games)]

    turns_by_player = [[] for _ in range(players)]
    good_by_player = [[] for _ in range(players)]
    bad_by_player = [[] for _ in range(players)]

    wins = [0 for _ in range(players)]
    for r in results:
        for idx in range(players):
            turns_by_player[idx].append(r["turns"][idx])
            good_by_player[idx].append(r["good_draws"][idx])
            bad_by_player[idx].append(r["bad_draws"][idx])
        wins[r["winner"]] += 1

    def avg(values: List[int]) -> float:
        return sum(values) / games

    def stdev(values: List[int]) -> float:
        mean = sum(values) / games
        return math.sqrt(sum((x - mean) ** 2 for x in values) / games)

    def percentile(values: List[int], p: float) -> int:
        values_sorted = sorted(values)
        return values_sorted[int(games * p)]

    per_player = []
    for idx in range(players):
        total = [g + b for g, b in zip(good_by_player[idx], bad_by_player[idx])]
        per_player.append(
            {
                "avg_turns": avg(turns_by_player[idx]),
                "avg_good_draws": avg(good_by_player[idx]),
                "avg_bad_draws": avg(bad_by_player[idx]),
                "avg_total_draws": avg(total),
                "turns_stdev": stdev(turns_by_player[idx]),
                "turns_p50": percentile(turns_by_player[idx], 0.5),
                "turns_p90": percentile(turns_by_player[idx], 0.9),
                "total_draws_stdev": stdev(total),
                "total_draws_p50": percentile(total, 0.5),
                "total_draws_p90": percentile(total, 0.9),
                "win_rate": wins[idx] / games,
            }
        )

    return {
        "games": games,
        "players": players,
        "per_player": per_player,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Simulate board game turns")
    parser.add_argument("spec", help="Path to board JSON file")
    parser.add_argument("--games", type=int, default=50000)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--players", type=int, default=1)
    args = parser.parse_args()

    with open(args.spec, "r", encoding="utf-8") as f:
        spec = json.load(f)

    stats = simulate(spec, args.games, args.seed, players=args.players)
    print(json.dumps(stats, indent=2))


if __name__ == "__main__":
    main()
