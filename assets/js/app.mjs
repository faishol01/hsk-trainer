import { data } from "../../data/vocabulary.mjs";
import { initialPositions } from "../../data/initial-positions.mjs";
import { localSentenceData } from "../../data/sentence-index.mjs";
import { initFlashcards } from "./flashcards.mjs";
import { initQuiz } from "./quiz.mjs";
import {
  buildWordRelationships,
  collectLinkedWords,
} from "./relationships.mjs";
import { createSpeechPlayer } from "./audio.mjs";
import { initSentenceExamples } from "./sentences.mjs";
import { esc, norm } from "./utils.mjs";

export function startApp() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        function finishNetworkLoading() {
          document.querySelector("#network-loading").hidden = true;
          const sidebar = document.querySelector("#sidebar");
          sidebar.inert = false;
          sidebar.removeAttribute("aria-busy");
          document.querySelector("#quiz-open").disabled = false;
          document.querySelector("#browse-words").disabled = false;
        }

        const search = document.querySelector("#search"),
          list = document.querySelector("#list"),
          canvas = document.querySelector("#canvas");
        let selected = -1;

        // Firebase is optional; local review remains available without configuration.
        const cloudReady = import("./cloud-sync.mjs")
          .then((module) => module.initCloudSync(data))
          .catch((error) => {
            const status = document.getElementById("cloud-status");
            status.textContent =
              "Cloud sync could not load. Local review is still available.";
            status.dataset.error = "true";
            const launch = document.getElementById("cloud-open");
            launch.disabled = false;
            launch.addEventListener("click", () =>
              document.getElementById("cloud-dialog").showModal(),
            );
            document
              .getElementById("cloud-close")
              .addEventListener("click", () =>
                document.getElementById("cloud-dialog").close(),
              );
            console.error("Cloud sync initialization failed", error);
            return null;
          });

        initFlashcards(data, cloudReady);

        const { edges, alternateReadings, neighborSets, linkedCounts } =
          buildWordRelationships(data);
        // Quiz selection is independent of the user interface, so it can be checked separately.
        function filterMatches(i) {
          const allowed = [
            ...document.querySelectorAll(".hsk-filter:checked"),
          ].map((e) => e.value);
          return (
            allowed.includes(data[i][4]) &&
            (!document.querySelector("#reading-filter").checked ||
              alternateReadings.has(i))
          );
        }
        function drawList() {
          let q = norm(search.value.trim()),
            matches = data
              .map((x, i) => ({ x, i }))
              .filter(
                (v) => filterMatches(v.i) && norm(v.x.join(" ")).includes(q),
              );
          let mode = document.querySelector("#sort").value;
          if (mode === "pinyin")
            matches.sort(
              (a, b) => norm(a.x[1]).localeCompare(norm(b.x[1])) || a.i - b.i,
            );
          else if (mode === "links-desc")
            matches.sort(
              (a, b) => linkedCounts[b.i] - linkedCounts[a.i] || a.i - b.i,
            );
          else if (mode === "links-asc")
            matches.sort(
              (a, b) => linkedCounts[a.i] - linkedCounts[b.i] || a.i - b.i,
            );
          else if (mode === "level")
            matches.sort((a, b) => a.x[4].localeCompare(b.x[4]) || a.i - b.i);
          document.querySelector("#count").textContent =
            matches.length + " words · select one to highlight";
          list.innerHTML = matches
            .map(
              ({ x, i }) =>
                `<button data-i="${i}" class="${i === selected ? "active" : ""}">${esc(x[0])}${alternateReadings.has(i) ? " ◈" : ""} <small>${esc(x[1])} · HSK ${esc(x[4].slice(-1))} · ${linkedCounts[i]} links</small></button>`,
            )
            .join("");
        }
        if (typeof vis === "undefined") {
          document.querySelector("#network-loading").hidden = true;
          canvas.innerHTML =
            '<p class="network-error">The network library could not be loaded. Connect to the internet and reopen this file.</p>';
          document.querySelector("#title").textContent = "Network unavailable";
          drawList();
        } else {
          const palette = {
            "hsk-1": { background: "#dff3e4", border: "#45986b" },
            "hsk-2": { background: "#e2edff", border: "#5989c9" },
            "hsk-3": { background: "#f3e3f5", border: "#ac78b4" },
            "hsk-4": { background: "#fff0de", border: "#d68c4b" },
          };
          function levelColor(level) {
            let c = palette[level] || palette["hsk-1"];
            return {
              ...c,
              highlight: { background: c.background, border: "#163f32" },
              hover: { background: c.background, border: "#163f32" },
            };
          }

          const nodes = new vis.DataSet(
            data.map((d, i) => ({
              id: i,
              x: initialPositions[i][0],
              y: initialPositions[i][1],
              label:
                d[0] + (alternateReadings.has(i) ? " ◈" : "") + "\n" + d[1],
              title:
                d[0] + " · " + d[1] + " · " + d[3] + " · HSK " + d[4].slice(-1),
              color: levelColor(d[4]),
            })),
          );
          const links = new vis.DataSet(
            edges.map((e) => ({
              id: e.id,
              from: e.from,
              to: e.to,
              arrows: { to: { enabled: !e.reading } },
              dashes: e.reading ? [6, 4] : false,
              color: {
                color: e.reading ? "#9b56a7" : "#acc7b3",
                opacity: e.reading ? 0.95 : 0.65,
              },
              width: e.reading ? 2 : 1,
              label: "",
            })),
          );
          const network = new vis.Network(
            canvas,
            { nodes, edges: links },
            {
              autoResize: true,
              layout: { randomSeed: 1731, improvedLayout: false },
              nodes: {
                shape: "box",
                margin: { top: 12, bottom: 12, left: 22, right: 22 },
                widthConstraint: { minimum: 100 },
                borderWidth: 1.5,
                font: {
                  face: "Arial",
                  size: 15,
                  color: "#254b35",
                  multi: false,
                },
              },
              edges: {
                smooth: false,
                arrows: { to: { scaleFactor: 0.45 } },
                font: { size: 11, background: "white", align: "middle" },
                selectionWidth: 1,
              },
              interaction: {
                hover: true,
                dragNodes: false,
                dragView: true,
                zoomView: true,
                hideEdgesOnDrag: false,
              },
              physics: {
                solver: "forceAtlas2Based",
                forceAtlas2Based: {
                  gravitationalConstant: -85,
                  centralGravity: 0.002,
                  springLength: 145,
                  springConstant: 0.1,
                  damping: 0.25,
                  avoidOverlap: 1,
                },
                stabilization: {
                  enabled: true,
                  iterations: 600,
                  updateInterval: 50,
                  fit: true,
                },
                maxVelocity: 90,
                timestep: 0.65,
                minVelocity: 0.2,
              },
            },
          );
          // Coordinates are in vis-network's canvas coordinate system, not screen pixels.
          window.getHskNodeCoordinates = () => {
            const positions = network.getPositions();
            return data.map((word, id) => ({
              id,
              word: word[0],
              pinyin: word[1],
              hsk: word[4],
              x: positions[id].x,
              y: positions[id].y,
            }));
          };

          const speakButton = document.querySelector("#speak-word"),
            speechStatus = document.querySelector("#speech-status");
          const { stopSpeech, playSpeech } = createSpeechPlayer();
          speakButton.addEventListener("click", () => {
            if (selected >= 0) playSpeech(data[selected][0], speechStatus);
          });
          const {
            examplesButton,
            examplesPanel,
            showExamples,
            getSentenceCorpus,
            invalidateExamples,
          } = initSentenceExamples({
            data,
            localSentenceData,
            getSelected: () => selected,
            playSpeech,
          });
          const linkedPanel = document.querySelector("#linked-panel"),
            linkedList = document.querySelector("#linked-list");
          function renderLinkedPanel(id) {
            const word = data[id],
              items = collectLinkedWords(id, edges, data);
            document.querySelector("#linked-panel-title").textContent =
              "Linked to " + word[0];
            document.querySelector("#linked-summary").textContent =
              items.length +
              " direct " +
              (items.length === 1 ? "connection" : "connections") +
              " · select a word to explore";
            linkedList.innerHTML = items.length
              ? items
                  .map(
                    ({ id, entry, relations }) =>
                      `<button type="button" class="linked-word" data-linked-id="${id}"><span class="linked-word-title">${esc(entry[0])}</span> <span class="linked-word-pinyin">${esc(entry[1])}</span><div class="linked-word-meaning">${esc(entry[3])}</div><div class="linked-word-meta">HSK ${esc(entry[4].slice(-1))} · ${esc(relations.join(", "))}</div></button>`,
                  )
                  .join("")
              : '<p class="linked-empty">No directly linked words.</p>';
            linkedPanel.hidden = false;
            linkedList.scrollTop = 0;
          }
          document
            .querySelector("#linked-close")
            .addEventListener("click", () => {
              linkedPanel.hidden = true;
            });
          linkedList.addEventListener("click", (e) => {
            let button = e.target.closest("[data-linked-id]");
            if (!button) return;
            let id = Number(button.dataset.linkedId);
            network.selectNodes([id]);
            highlight(id);
            network.focus(id, {
              scale: 1.15,
              animation: { duration: 450, easingFunction: "easeInOutQuad" },
            });
          });
          function highlight(i) {
            stopSpeech();
            selected = i;
            renderLinkedPanel(i);
            speakButton.disabled = false;
            examplesButton.disabled = false;
            speechStatus.textContent = "";
            if (!examplesPanel.hidden) showExamples();
            let adjacent = new Set([i]),
              active = new Set();
            edges.forEach((e) => {
              if (e.from === i || e.to === i) {
                adjacent.add(e.from);
                adjacent.add(e.to);
                active.add(e.id);
              }
            });
            nodes.update(
              data.map((d, j) => ({
                id: j,
                color: adjacent.has(j)
                  ? levelColor(d[4])
                  : { background: "#f7faf7", border: "#e2eae3" },
                borderWidth: j === i ? 4 : adjacent.has(j) ? 3 : 1,
                font: { color: adjacent.has(j) ? "#20382b" : "#b0bdb3" },
              })),
            );
            links.update(
              edges.map((e) => ({
                id: e.id,
                color: {
                  color: active.has(e.id)
                    ? e.reading
                      ? "#8d3e9d"
                      : "#32945d"
                    : "#dce8de",
                  opacity: active.has(e.id) ? 1 : 0.25,
                },
                width: active.has(e.id) ? 2 : 1,
                label: active.has(e.id) ? e.kind : "",
              })),
            );
            let d = data[i];
            document.querySelector("#title").textContent = d[0] + "  " + d[1];
            document.querySelector("#desc").textContent =
              d[3] +
              " · HSK " +
              d[4].slice(-1) +
              " · " +
              (adjacent.size - 1) +
              " linked words";
            drawList();
          }
          function applyFilters() {
            linkedPanel.hidden = true;
            selected = -1;
            speakButton.disabled = true;
            examplesButton.disabled = true;
            examplesPanel.hidden = true;
            examplesButton.setAttribute("aria-expanded", "false");
            invalidateExamples();
            stopSpeech();
            speechStatus.textContent = "";
            network.unselectAll();
            let passing = data.map((_, i) => filterMatches(i));
            nodes.update(
              data.map((d, i) => ({
                id: i,
                color: passing[i]
                  ? levelColor(d[4])
                  : { background: "#f7faf7", border: "#e2eae3" },
                borderWidth: passing[i] ? 1.5 : 1,
                font: { color: passing[i] ? "#254b35" : "#b0bdb3" },
              })),
            );
            links.update(
              edges.map((e) => ({
                id: e.id,
                color: {
                  color:
                    passing[e.from] && passing[e.to]
                      ? e.reading
                        ? "#9b56a7"
                        : "#acc7b3"
                      : "#dce8de",
                  opacity:
                    passing[e.from] && passing[e.to]
                      ? e.reading
                        ? 0.95
                        : 0.65
                      : 0.18,
                },
                width: e.reading ? 2 : 1,
                label: "",
              })),
            );
            document.querySelector("#title").textContent = "All words";
            document.querySelector("#desc").textContent =
              passing.filter(Boolean).length +
              " matching words · select a word to highlight its links";
            drawList();
          }
          function reset() {
            applyFilters();
            network.fit({
              animation: { duration: 450, easingFunction: "easeInOutQuad" },
            });
          }
          initQuiz({
            data,
            neighborSets,
            localSentenceData,
            cloudReady,
            getSentenceCorpus,
            network,
            isLayoutFixed: () => layoutFixed,
          });
          network.on("click", (p) => {
            if (p.nodes.length) highlight(p.nodes[0]);
          });
          search.addEventListener("input", drawList);
          document.querySelector("#sort").addEventListener("change", drawList);
          document
            .querySelectorAll(".hsk-filter,#reading-filter")
            .forEach((el) => el.addEventListener("change", applyFilters));
          list.addEventListener("click", (e) => {
            let b = e.target.closest("[data-i]");
            if (b) {
              let i = +b.dataset.i;
              network.selectNodes([i]);
              highlight(i);
              network.focus(i, {
                scale: 1.15,
                animation: { duration: 450, easingFunction: "easeInOutQuad" },
              });
            }
          });
          document.querySelector("#reset").addEventListener("click", reset);
          // After physics settles, separate any remaining bounding boxes and freeze the layout.
          let layoutFixed = false;
          const toggle = document.querySelector("#toggle-physics");
          let autoTimer;
          function freezeLayout() {
            if (layoutFixed) return;
            layoutFixed = true;
            toggle.textContent = "Resume arrangement";
            toggle.setAttribute("aria-pressed", "true");
            network.setOptions({ physics: { enabled: false } });
            const ids = nodes.getIds(),
              placed = [],
              gap = 18;
            for (const id of ids) {
              let position = network.getPositions([id])[id],
                box = network.getBoundingBox(id),
                w = box.right - box.left,
                h = box.bottom - box.top,
                x = position.x,
                y = position.y,
                attempt = 0;
              function available(x, y) {
                return placed.every(
                  (q) =>
                    Math.abs(x - q.x) >= (w + q.w) / 2 + gap ||
                    Math.abs(y - q.y) >= (h + q.h) / 2 + gap,
                );
              }
              while (!available(x, y)) {
                attempt++;
                let radius = 18 * Math.sqrt(attempt),
                  angle = attempt * 2.399963229728653;
                x = position.x + radius * Math.cos(angle);
                y = position.y + radius * Math.sin(angle);
              }
              network.moveNode(id, x, y);
              placed.push({ x, y, w, h });
            }
            network.once("afterDrawing", finishNetworkLoading);
            network.fit();
            setTimeout(finishNetworkLoading, 1000);
          }
          autoTimer = setTimeout(freezeLayout, 10000);
          toggle.addEventListener("click", () => {
            clearTimeout(autoTimer);
            network.off("stabilized", freezeLayout);
            if (layoutFixed) {
              layoutFixed = false;
              toggle.textContent = "Pause arrangement";
              toggle.setAttribute("aria-pressed", "false");
              network.setOptions({ physics: { enabled: true } });
              network.startSimulation();
            } else freezeLayout();
          });
          reset();
        }
      } catch (error) {
        const loader = document.querySelector("#network-loading");
        loader.innerHTML =
          '<div class="loading-card"><strong>Could not load the network</strong><span>Refresh the page to try again.</span></div>';
        console.error(error);
      }
    }),
  );
}
