# Changelog

## 0.4.0 - 2026-11-06

- Add `surfing_search_all`, which searches Bilibili, Tieba, Moegirlpedia and Baidu Baike in parallel and returns short results. Open numbered results and further Tieba results with `surfing_read_page`. The WebUI has a switch for each source and a per-source result limit.
- Merge `surfing_read_bili_info` and `surfing_read_bili_comments` into `surfing_read_bili`. The old tool names are removed; pass `mode: "info"` or `mode: "comments"` instead.
- Add nbnhhsh abbreviation lookup as the fifth `surfing_search_all` source. It is on by default, including for existing configs without the new setting, and sends every letter and digit fragment of the query to nbnhhsh; turn it off in the site search settings.
- Add a proxy compatibility mode for Clash-style fake-IP DNS, off by default. When on, reads accept common IPv4 and IPv6 proxy address ranges and optional custom ranges, and the proxy decides the real destination, which can include local or private services. Blocked reads to common proxy ranges explain where to enable the mode.
- Restore the previous value when saving a setting from the WebUI fails.
- Expand the environment prompt with guidance on source choice, looking up unfamiliar terms, recording how a group uses them and joining game chat. Parts of it derive from `cortico-world-learn-alont1`; the MIT notice ships in `THIRD_PARTY_NOTICES.md`.

## 0.3.2 - 2026-11-03

- Use Microlink to render pages when local Chromium is unavailable, with an optional API key and keyless requests.
- Merge reading limits and Microlink settings into one WebUI config panel, with key file actions, key status and step-by-step API key instructions.

## 0.3.1 - 2026-10-30

- Align development and CI validation with Cortico 0.2.10.

## 0.3.0 - 2026-10-21

- Add anonymous video description and comment readers, including hot/latest ordering, pinned comments, thread replies and cursor continuation.
- Shorten the environment prompt and remove instructions already in tool descriptions.

## 0.2.0 - 2026-10-16

- Remove Bilibili QR login, saved-session handling and the login panel. Subtitle reading and search use anonymous requests; deployments can remove `CORTICO_SURFING_BILI_SESSION` from `.env`.
- Target Cortico 0.2.1 and world contract 6.
- Rename console contributions and imports to WebUI.
- Add extension self-description, official index tags and publishing guidance.

## 0.1.0

- Last release using the previous Cortico extension contract.
