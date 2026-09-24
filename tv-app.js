/* ============================================================================
   MoodMovie TV — versione dedicata Smart TV datate (scritta in JavaScript
   "stile 2014/2015": niente arrow function, const/let, template literal,
   async/await, Promise, fetch, AbortController, MutationObserver, Set/Map.
   Le richieste dati usano XMLHttpRequest con callback classiche.
   ============================================================================ */

var API_KEY = 'b960ea3a0f017ede523e34c7f5303835';
var BASE_URL = 'https://api.themoviedb.org/3';

var page = 1;
var isFetching = false;
var currentMode = 'movie';
var searchActive = false;
var currentMovies = [];
var currentTrailerKey = '';
var currentSimilarId = null;
var currentCategoryId = null;
var currentCategoryName = '';
var genreCacheMovie = null;
var genreCacheTv = null;
var searchType = 'vibes';
var selectedSeason = 1;
var selectedEpisode = 1;
var currentView = 'home';
var currentTvId = null;
var requestToken = 0;
var resumeItem = null;

var continueWatching = [];
try { continueWatching = JSON.parse(localStorage.getItem('continueWatching')) || []; } catch (e) { continueWatching = []; }

/* ── Helper HTTP: XMLHttpRequest con callback, sostituisce fetch()/Promise ── */
function getJSON(url, onSuccess, onError) {
    var xhr = new XMLHttpRequest();
    try {
        xhr.open('GET', url, true);
    } catch (e) {
        if (onError) onError(e);
        return null;
    }
    xhr.onreadystatechange = function () {
        if (xhr.readyState === 4) {
            if (xhr.status >= 200 && xhr.status < 300) {
                var data = null;
                try { data = JSON.parse(xhr.responseText); } catch (e2) { if (onError) onError(e2); return; }
                onSuccess(data);
            } else if (onError) {
                onError(new Error('HTTP ' + xhr.status));
            }
        }
    };
    xhr.onerror = function () { if (onError) onError(new Error('network error')); };
    xhr.send();
    return xhr;
}

/* Esegue piu' richieste in parallelo e chiama onAllSuccess quando tutte sono
   arrivate, nello stesso ordine (sostituisce Promise.all). */
function getJSONParallel(urls, onAllSuccess, onError) {
    var results = [];
    var remaining = urls.length;
    var failed = false;
    var i;
    for (i = 0; i < urls.length; i++) results.push(null);
    function makeHandler(idx) {
        return function (data) {
            if (failed) return;
            results[idx] = data;
            remaining--;
            if (remaining === 0) onAllSuccess(results);
        };
    }
    for (i = 0; i < urls.length; i++) {
        getJSON(urls[i], makeHandler(i), function (err) {
            if (failed) return;
            failed = true;
            if (onError) onError(err);
        });
    }
}

/* Trova il primo elemento di un array che soddisfa una condizione (al posto
   di Array.prototype.find, non disponibile su motori piu' vecchi). */
function findFirst(arr, predicate) {
    for (var i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i)) return arr[i];
    }
    return null;
}
function findFirstIndex(arr, predicate) {
    for (var i = 0; i < arr.length; i++) {
        if (predicate(arr[i], i)) return i;
    }
    return -1;
}
function stringContains(str, needle) { return (str || '').indexOf(needle) > -1; }
function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function qs(id) { return document.getElementById(id); }

var MOOD_DATA = [
    { keys: ["triste", "piangere", "commovente", "malinconico", "dramma", "drammatico"], genre: 18, keywords: "9717|10531|172088" },
    { keys: ["allegro", "ridere", "divertente", "felice", "comicità", "commedia"], genre: 35 },
    { keys: ["adrenalina", "azione", "movimento", "esplosivo", "combattimento", "lotta"], genre: 28, keywords: "9748" },
    { keys: ["spavento", "paura", "horror", "terrore", "mostri"], genre: 27 },
    { keys: ["brivido", "thriller", "tensione", "suspense"], genre: 53 },
    { keys: ["romantico", "amore", "innamorati", "fidanzati"], genre: 10749 },
    { keys: ["distopico", "distopia", "futuro cupo", "apocalisse", "apocalittico", "post-apocalittico"], keywords: "4565|285366|4458" },
    { keys: ["spionaggio", "spie", "agente segreto", "007"], keywords: "470|10410" },
    { keys: ["catastrofe", "disastro", "calamità", "fine del mondo", "terremoto", "tsunami", "vulcano", "disastri naturali", "sopravvivenza"], keywords: "2333|12586|156066|155254|10484|1604|161042" },
    { keys: ["supereroi", "super eroi", "super eroe", "vendicatori", "marvel", "dc"], keywords: "9715|180547" },
    { keys: ["spazio", "alieni", "alieno", "ufo", "galassia", "interstellare", "astronave"], keywords: "3801|9882|9951|15255" },
    { keys: ["zombie", "morti viventi", "epidemia", "virus"], keywords: "12377|186671" },
    { keys: ["viaggi nel tempo", "ritorno al futuro", "linea temporale"], keywords: "9840|11340" },
    { keys: ["investigazione", "detective", "giallo", "poliziesco", "indagine", "noir"], genre: 9648, keywords: "212|9826" },
    { keys: ["biografia", "storia vera", "biopic", "reale"], keywords: "5565|9672" },
    { keys: ["cyberpunk", "tecnologia", "futuristico"], keywords: "290320|15250" },
    { keys: ["sport", "calcio", "basket", "atleti", "gara"], keywords: "6075|5661" }
];

/* ── Rotazione giornaliera sezione "Popolari" ── */
function getPopularDayKey() {
    var now = new Date();
    var d = new Date(now.getTime());
    if (now.getHours() < 6) d.setDate(d.getDate() - 1);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
}
function getDailyPopularPage(maxPage) {
    maxPage = maxPage || 10;
    var key = getPopularDayKey() + '|' + currentMode;
    var hash = 0;
    for (var i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
    return (hash % maxPage) + 1;
}
function getRecentCutoffDate(monthsBack) {
    monthsBack = monthsBack || 18;
    var d = new Date();
    d.setMonth(d.getMonth() - monthsBack);
    return d.toISOString().slice(0, 10);
}
function buildRecentPopularUrl(pageNum) {
    var dateField = currentMode === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';
    return BASE_URL + '/discover/' + currentMode + '?api_key=' + API_KEY + '&language=it-IT&sort_by=popularity.desc&' + dateField + '=' + getRecentCutoffDate() + '&vote_count.gte=30&page=' + pageNum;
}

/* ── Menu di ricerca (hamburger) ── */
function toggleSearchMenu(e) {
    if (e) e.stopPropagation();
    var menu = qs('searchMenu');
    var trigger = qs('menuTrigger');
    var r = trigger.getBoundingClientRect();
    menu.style.top = (r.bottom + 10) + 'px';
    menu.style.left = r.left + 'px';
    if (menu.className.indexOf('active') > -1) {
        menu.className = menu.className.replace(' active', '');
    } else {
        menu.className += ' active';
        var first = menu.querySelector('.menu-item');
        if (first) focusEl(first);
    }
}
function closeSearchMenu() { qs('searchMenu').className = qs('searchMenu').className.replace(' active', ''); }
function closeCategoryMenu() { qs('categoryMenu').className = qs('categoryMenu').className.replace(' active', ''); }

function setSearchMode(mode) {
    searchType = mode;
    var input = qs('searchInput');
    input.placeholder = mode === 'vibes' ? "Es: super eroe, catastrofi, brividi..." : "Es: Tom Cruise, Brad Pitt...";
    var items = document.querySelectorAll('#searchMenu .menu-item');
    for (var i = 0; i < items.length; i++) items[i].className = items[i].className.replace(' selected', '');
    closeSearchMenu();
    focusEl(qs('menuTrigger'));
}

function showCategoryMenu() {
    closeSearchMenu();
    var catMenu = qs('categoryMenu');
    var trigger = qs('menuTrigger');
    var r = trigger.getBoundingClientRect();
    catMenu.style.top = (r.bottom + 10) + 'px';
    catMenu.style.left = r.left + 'px';
    var cached = currentMode === 'movie' ? genreCacheMovie : genreCacheTv;
    if (cached) {
        renderCategoryMenu(cached);
        return;
    }
    getJSON(BASE_URL + '/genre/' + currentMode + '/list?api_key=' + API_KEY + '&language=it-IT', function (data) {
        var genres = data.genres || [];
        if (currentMode === 'movie') genreCacheMovie = genres; else genreCacheTv = genres;
        renderCategoryMenu(genres);
    }, function () {
        renderCategoryMenu([]);
    });
}
function renderCategoryMenu(genres) {
    var catMenu = qs('categoryMenu');
    var html = '<div class="menu-item" id="catBackBtn"><i class="fa-solid fa-arrow-left"></i> Indietro</div>';
    for (var i = 0; i < genres.length; i++) {
        html += '<div class="menu-item cat-genre-item" data-genre-id="' + genres[i].id + '" data-genre-name="' + escapeHtml(genres[i].name) + '">' + escapeHtml(genres[i].name) + '</div>';
    }
    catMenu.innerHTML = html;
    catMenu.className += ' active';
    var backBtn = qs('catBackBtn');
    if (backBtn) backBtn.onclick = function () { closeCategoryMenu(); qs('searchMenu').className += ' active'; focusFirstIn(qs('searchMenu')); };
    var genreItems = catMenu.querySelectorAll('.cat-genre-item');
    for (var j = 0; j < genreItems.length; j++) {
        genreItems[j].onclick = function () {
            selectCategory(parseInt(this.getAttribute('data-genre-id'), 10), this.getAttribute('data-genre-name'), false);
        };
    }
    focusFirstIn(catMenu);
}

function selectCategory(genreId, genreName, append) {
    if (!append) {
        closeCategoryMenu();
        searchActive = false;
        currentSimilarId = null;
        currentCategoryId = genreId;
        currentCategoryName = genreName;
        page = 1;
        qs('searchInput').value = '';
        qs('movieGrid').innerHTML = '';
        qs('sortBarRow').style.display = 'flex';
        qs('sectionTitle').style.display = 'block';
        qs('sectionTitle').innerText = 'Categoria: ' + genreName;
        window.scrollTo(0, 0);
    }
    isFetching = true;
    qs('loading').style.display = 'block';
    var myToken = ++requestToken;
    getJSON(BASE_URL + '/discover/' + currentMode + '?api_key=' + API_KEY + '&language=it-IT&with_genres=' + currentCategoryId + '&sort_by=popularity.desc&page=' + page, function (data) {
        if (myToken !== requestToken) return;
        currentMovies = append ? currentMovies.concat(data.results) : data.results;
        renderItems(data.results, append);
        qs('loadMoreBtn').style.display = (data.total_pages > page) ? 'block' : 'none';
        qs('loading').style.display = 'none';
        isFetching = false;
    }, function () {
        if (myToken !== requestToken) return;
        qs('loading').style.display = 'none';
        isFetching = false;
    });
}

/* ── Cambio Film / Serie TV ── */
function switchMode(mode) {
    requestToken++;
    isFetching = false;
    currentMode = mode;
    currentView = 'home';
    searchActive = false;
    currentSimilarId = null;
    currentCategoryId = null;
    page = 1;
    qs('searchInput').value = '';
    var navs = document.querySelectorAll('.nav-link');
    for (var i = 0; i < navs.length; i++) navs[i].className = navs[i].className.replace(' active', '');
    qs(mode === 'movie' ? 'homeBtn' : 'tvBtn').className += ' active';
    qs('sortBarRow').style.display = 'none';
    qs('sectionTitle').style.display = 'none';
    qs('movieGrid').innerHTML = '';
    qs('loadMoreBtn').style.display = 'none';
    window.scrollTo(0, 0);
    loadContent(false);
}

/* ── Caricamento contenuti home ── */
function loadContent(append) {
    requestToken++;
    var myToken = requestToken;
    isFetching = true;
    qs('loading').style.display = 'block';
    var urls = [
        BASE_URL + '/trending/' + currentMode + '/week?api_key=' + API_KEY + '&language=it-IT',
        BASE_URL + '/' + currentMode + '/' + (currentMode === 'movie' ? 'now_playing' : 'on_the_air') + '?api_key=' + API_KEY + '&language=it-IT&page=1',
        buildRecentPopularUrl(getDailyPopularPage())
    ];
    getJSONParallel(urls, function (results) {
        if (myToken !== requestToken) return;
        qs('loading').style.display = 'none';
        isFetching = false;
        renderHomeSections((results[0] && results[0].results) || [], (results[1] && results[1].results) || [], (results[2] && results[2].results) || []);
    }, function () {
        if (myToken !== requestToken) return;
        qs('loading').style.display = 'none';
        isFetching = false;
    });
}

function renderHomeSections(trending, recent, topRated) {
    var grid = qs('movieGrid');
    grid.className = 'home-sections';
    grid.innerHTML = '';
    qs('sortBarRow').style.display = 'none';
    qs('sectionTitle').style.display = 'none';
    qs('loadMoreBtn').style.display = 'none';

    var cwSection = buildHomeSection('Continua a guardare');
    var cwRow = cwSection.querySelector('.home-row');
    var cwItems = [];
    for (var ci = 0; ci < continueWatching.length; ci++) if (continueWatching[ci].mode === currentMode) cwItems.push(continueWatching[ci]);
    if (cwItems.length === 0) {
        cwRow.innerHTML = '<div class="home-empty">Nessun contenuto in corso.</div>';
    } else {
        for (var cj = 0; cj < cwItems.length; cj++) cwRow.appendChild(buildContinueCard(cwItems[cj]));
    }
    grid.appendChild(cwSection);

    var evSection = buildHomeSection('In evidenza');
    var evRow = evSection.querySelector('.home-row');
    var evSeen = {};
    var evInitial = [];
    for (var e1 = 0; e1 < trending.length; e1++) if (trending[e1].poster_path) evInitial.push(trending[e1]);
    for (var e2 = 0; e2 < evInitial.length; e2++) evSeen[evInitial[e2].id] = true;
    var evState = { buffer: evInitial.slice(15), page: 2, exhausted: false, seen: evSeen };
    var evFirst = evInitial.slice(0, 15);
    for (var e3 = 0; e3 < evFirst.length; e3++) evRow.appendChild(buildHomeCard(evFirst[e3]));
    var evLoadMoreCard = buildLoadMoreCard(function (done) {
        fetchMoreGeneric(evState, currentMode, function (d) {
            return BASE_URL + '/trending/' + currentMode + '/week?api_key=' + API_KEY + '&language=it-IT&page=' + d.page;
        }, function () {
            var batch = evState.buffer.splice(0, 15);
            for (var bi = 0; bi < batch.length; bi++) evRow.insertBefore(buildHomeCard(batch[bi]), evLoadMoreCard);
            done();
        });
    });
    evRow.appendChild(evLoadMoreCard);
    grid.appendChild(evSection);

    var novSection = buildHomeSection('Novità');
    var novRow = novSection.querySelector('.home-row');
    var novSeen = {};
    var novInitial = [];
    for (var n1 = 0; n1 < recent.length; n1++) if (recent[n1].poster_path) novInitial.push(recent[n1]);
    for (var n2 = 0; n2 < novInitial.length; n2++) novSeen[novInitial[n2].id] = true;
    var novState = { buffer: novInitial.slice(15), page: 2, exhausted: false, seen: novSeen };
    var novFirst = novInitial.slice(0, 15);
    for (var n3 = 0; n3 < novFirst.length; n3++) novRow.appendChild(buildHomeCard(novFirst[n3]));
    var novLoadMoreCard = buildLoadMoreCard(function (done) {
        var endpoint = currentMode === 'movie' ? 'now_playing' : 'on_the_air';
        fetchMoreGeneric(novState, currentMode, function (d) {
            return BASE_URL + '/' + currentMode + '/' + endpoint + '?api_key=' + API_KEY + '&language=it-IT&page=' + d.page;
        }, function () {
            var batch = novState.buffer.splice(0, 15);
            for (var bi = 0; bi < batch.length; bi++) novRow.insertBefore(buildHomeCard(batch[bi]), novLoadMoreCard);
            done();
        });
    });
    novRow.appendChild(novLoadMoreCard);
    grid.appendChild(novSection);

    var similarRef = pickSimilarRef();
    if (similarRef) {
        var simSection = buildHomeSection('Simili a <span>' + escapeHtml(similarRef.title) + '</span>');
        var simRow = simSection.querySelector('.home-row');
        grid.appendChild(simSection);
        loadSimilarSection(similarRef.id, similarRef.mode || currentMode, simRow);
    }

    var gridSec = document.createElement('div');
    gridSec.className = 'home-section';
    gridSec.innerHTML = '<div class="home-section-header"><div class="home-section-title">Popolari</div></div><div id="homeVerticalGrid" class="movie-grid" style="margin-bottom:16px;"></div>';
    grid.appendChild(gridSec);
    var vgSeen = {};
    var vgInitial = [];
    for (var v1 = 0; v1 < topRated.length; v1++) if (topRated[v1].poster_path) vgInitial.push(topRated[v1]);
    for (var v2 = 0; v2 < vgInitial.length; v2++) vgSeen[vgInitial[v2].id] = true;
    var vgState = { page: getDailyPopularPage() + 1, seen: vgSeen, usePopular: false, popularPage: 1, buffer: [] };
    var vgGrid = gridSec.querySelector('#homeVerticalGrid');
    function appendVerticalItems(items) {
        for (var idx = 0; idx < items.length; idx++) {
            (function (item, idx2) {
                var title = item.title || item.name || '';
                var card = document.createElement('div');
                card.className = 'movie-card';
                card.innerHTML = '<img src="https://image.tmdb.org/t/p/w342' + item.poster_path + '" loading="lazy">';
                card.onclick = function () { openModal(item.id, currentMode); };
                vgGrid.appendChild(card);
                setTimeout(function () { card.className += ' show'; }, idx2 * 20);
            })(items[idx], idx);
        }
    }
    appendVerticalItems(vgInitial.slice(0, 20));
    vgState.buffer = vgInitial.slice(20);
    var vgLoadMoreCard = document.createElement('button');
    vgLoadMoreCard.className = 'load-more-btn';
    vgLoadMoreCard.style.display = 'block';
    vgLoadMoreCard.textContent = 'CARICA ALTRI';
    vgLoadMoreCard.onclick = function () {
        vgLoadMoreCard.style.display = 'none';
        qs('loading').style.display = 'block';
        fetchMoreVertical(vgState, function () {
            var batch = vgState.buffer.splice(0, 20);
            appendVerticalItems(batch);
            qs('loading').style.display = 'none';
            vgLoadMoreCard.style.display = 'block';
        });
    };
    vgGrid.parentNode.insertBefore(vgLoadMoreCard, vgGrid.nextSibling);
}

function fetchMoreGeneric(state, mode, urlBuilder, done) {
    if (state.buffer.length >= 15 || state.exhausted) { done(); return; }
    getJSON(urlBuilder(state), function (d) {
        state.page++;
        var items = (d.results || []);
        var filtered = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].poster_path && !state.seen[items[i].id]) { state.seen[items[i].id] = true; filtered.push(items[i]); }
        }
        state.buffer = state.buffer.concat(filtered);
        if (!d.total_pages || state.page > d.total_pages) state.exhausted = true;
        fetchMoreGeneric(state, mode, urlBuilder, done);
    }, function () { state.exhausted = true; done(); });
}

function fetchMoreVertical(state, done) {
    if (state.buffer.length >= 20) { done(); return; }
    var url;
    if (!state.usePopular && state.page <= 10) {
        url = buildRecentPopularUrl(state.page);
    } else {
        state.usePopular = true;
        url = BASE_URL + '/' + currentMode + '/popular?api_key=' + API_KEY + '&language=it-IT&page=' + state.popularPage;
    }
    getJSON(url, function (d) {
        if (!state.usePopular) { state.page++; if (!d.total_pages || state.page > Math.min(d.total_pages, 10)) state.usePopular = true; }
        else { state.popularPage++; }
        var items = (d.results || []);
        var filtered = [];
        for (var i = 0; i < items.length; i++) {
            if (items[i].poster_path && !state.seen[items[i].id]) { state.seen[items[i].id] = true; filtered.push(items[i]); }
        }
        state.buffer = state.buffer.concat(filtered);
        fetchMoreVertical(state, done);
    }, done);
}

function buildLoadMoreCard(onLoad) {
    var card = document.createElement('div');
    card.className = 'home-card-loadmore';
    card.innerHTML = '<i class="fa-solid fa-rotate"></i><span>Carica altri</span>';
    card.onclick = function () {
        if (card.className.indexOf('is-fetching') > -1) return;
        card.className += ' is-fetching';
        onLoad(function () { card.className = card.className.replace(' is-fetching', ''); });
    };
    return card;
}

function buildHomeSection(titleHtml) {
    var sec = document.createElement('div');
    sec.className = 'home-section';
    sec.innerHTML = '<div class="home-section-header"><div class="home-section-title">' + titleHtml + '</div></div><div class="home-row"></div>';
    return sec;
}

function buildHomeCard(item, mode) {
    var cardMode = mode || currentMode;
    var card = document.createElement('div');
    card.className = 'home-card';
    card.innerHTML = '<img src="https://image.tmdb.org/t/p/w342' + item.poster_path + '" loading="lazy">';
    card.onclick = function () { openModal(item.id, cardMode); };
    return card;
}

function buildContinueCard(item) {
    var card = document.createElement('div');
    card.className = 'home-card';
    var pct = item.progress ? Math.min(100, Math.round(item.progress * 100)) : 0;
    card.innerHTML =
        '<img src="https://image.tmdb.org/t/p/w342' + item.poster_path + '" loading="lazy">' +
        '<button class="home-card-del"><i class="fa-solid fa-xmark"></i></button>' +
        '<div class="home-card-progress"><div class="home-card-progress-bar" style="width:' + pct + '%"></div></div>';
    var delBtn = card.querySelector('.home-card-del');
    delBtn.onclick = function (e) { e.stopPropagation(); removeContinueWatching(item.id, item.mode); };
    card.onclick = function (e) {
        if (e.target === delBtn || (delBtn.contains && delBtn.contains(e.target))) return;
        openModalAndResume(item);
    };
    return card;
}

function pickSimilarRef() {
    var cwItem = findFirst(continueWatching, function (c) { return c.mode === currentMode; });
    if (cwItem) return { id: cwItem.id, title: cwItem.title, mode: cwItem.mode };
    return null;
}

function loadSimilarSection(id, type, row) {
    var state = { buffer: [], tmdbPage: 1, totalPages: 1, exhausted: false, seen: {} };
    function fetchMorePagesIfNeeded(minCount, cb) {
        if (state.buffer.length >= minCount || state.exhausted || state.tmdbPage > state.totalPages) { cb(); return; }
        getJSON(BASE_URL + '/' + type + '/' + id + '/recommendations?api_key=' + API_KEY + '&language=it-IT&page=' + state.tmdbPage, function (data) {
            state.totalPages = data.total_pages || 1;
            var items = data.results || [];
            var filtered = [];
            for (var i = 0; i < items.length; i++) {
                if (items[i].poster_path && !state.seen[items[i].id]) { state.seen[items[i].id] = true; filtered.push(items[i]); }
            }
            state.buffer = state.buffer.concat(filtered);
            state.tmdbPage++;
            if (state.tmdbPage > state.totalPages) state.exhausted = true;
            fetchMorePagesIfNeeded(minCount, cb);
        }, function () { state.exhausted = true; cb(); });
    }
    fetchMorePagesIfNeeded(15, function () {
        var firstBatch = state.buffer.splice(0, 15);
        if (firstBatch.length === 0) { row.innerHTML = '<div class="home-empty">Nessun titolo simile trovato.</div>'; return; }
        for (var i = 0; i < firstBatch.length; i++) row.appendChild(buildHomeCard(firstBatch[i], type));
        if (state.buffer.length > 0 || !state.exhausted) {
            var loadMoreCard = buildLoadMoreCard(function (done) {
                fetchMorePagesIfNeeded(15, function () {
                    var nextBatch = state.buffer.splice(0, 15);
                    for (var j = 0; j < nextBatch.length; j++) row.insertBefore(buildHomeCard(nextBatch[j], type), loadMoreCard);
                    if (nextBatch.length === 0) loadMoreCard.parentNode && loadMoreCard.parentNode.removeChild(loadMoreCard);
                    done();
                });
            });
            row.appendChild(loadMoreCard);
        }
    });
}

function requestFullscreenOn(el) {
    if (!el) return;
    try {
        if (el.requestFullscreen) el.requestFullscreen();
        else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        else if (el.webkitRequestFullScreen) el.webkitRequestFullScreen();
        else if (el.mozRequestFullScreen) el.mozRequestFullScreen();
        else if (el.msRequestFullscreen) el.msRequestFullscreen();
    } catch (e) {}
}

function formatResumeTime(totalSeconds) {
    var h = Math.floor(totalSeconds / 3600);
    var m = Math.floor((totalSeconds % 3600) / 60);
    var s = Math.floor(totalSeconds % 60);
    var parts = [];
    if (h > 0) parts.push(h + 'h');
    if (h > 0 || m > 0) parts.push(m + 'min');
    parts.push(s + 's');
    return parts.join(' ');
}

function saveContinueWatching() { localStorage.setItem('continueWatching', JSON.stringify(continueWatching)); }

function updateContinueWatching(id, title, poster_path, mode, progress, resumeTime, season, episode) {
    var idx = findFirstIndex(continueWatching, function (c) { return c.id === id && c.mode === mode; });
    var existing = idx > -1 ? continueWatching[idx] : {};
    var entry = {
        id: id, title: title, poster_path: poster_path, mode: mode,
        progress: progress || existing.progress || 0.05,
        resumeTime: resumeTime !== undefined ? resumeTime : (existing.resumeTime || 0),
        season: season !== undefined ? season : existing.season,
        episode: episode !== undefined ? episode : existing.episode,
        ts: new Date().getTime()
    };
    if (idx > -1) continueWatching[idx] = entry; else continueWatching.unshift(entry);
    saveContinueWatching();
}

function removeContinueWatching(id, mode) {
    var filtered = [];
    for (var i = 0; i < continueWatching.length; i++) {
        if (!(continueWatching[i].id === id && continueWatching[i].mode === mode)) filtered.push(continueWatching[i]);
    }
    continueWatching = filtered;
    saveContinueWatching();
    var cwRow = document.querySelector('.home-sections .home-section:first-child .home-row');
    if (cwRow) {
        cwRow.innerHTML = '';
        var cwItems = [];
        for (var j = 0; j < continueWatching.length; j++) if (continueWatching[j].mode === currentMode) cwItems.push(continueWatching[j]);
        if (cwItems.length === 0) cwRow.innerHTML = '<div class="home-empty">Nessun contenuto in corso.</div>';
        else for (var k = 0; k < cwItems.length; k++) cwRow.appendChild(buildContinueCard(cwItems[k]));
    }
}

var progressInterval = null;
function startProgressTracking(id, title, poster_path, mode) {
    if (progressInterval) clearInterval(progressInterval);
    progressInterval = setInterval(function () {
        var iframe = document.querySelector('#videoPlayer iframe');
        if (!iframe) { clearInterval(progressInterval); progressInterval = null; return; }
        var cwEntry = findFirst(continueWatching, function (c) { return c.id === id && c.mode === mode; });
        var prevTime = cwEntry ? (cwEntry.resumeTime || 0) : 0;
        var newTime = prevTime + 5;
        var newProgress = Math.min(0.99, (cwEntry ? cwEntry.progress || 0.05 : 0.05) + 0.0015);
        updateContinueWatching(id, title, poster_path, mode, newProgress, newTime);
    }, 5000);
}

var vixsrcCtx = null;
window.addEventListener('message', function (e) {
    if (!vixsrcCtx) return;
    if (e.origin !== 'https://vixsrc.to') return;
    var iframe = document.querySelector('#videoPlayer iframe');
    if (!iframe || e.source !== iframe.contentWindow) return;
    if (!e.data || e.data.type !== 'PLAYER_EVENT') return;
    var d = e.data.event;
    if (!d || typeof d.currentTime !== 'number') return;
    if (vixsrcCtx.expectedStart !== undefined && !vixsrcCtx.checked) {
        vixsrcCtx.checked = true;
        if (!vixsrcCtx.retried && vixsrcCtx.expectedStart > 60 && d.currentTime < 10) {
            vixsrcCtx.retried = true;
            var sep = vixsrcCtx.embedUrl.indexOf('?') > -1 ? '&' : '?';
            iframe.src = vixsrcCtx.embedUrl + sep + '_retry=1';
            return;
        }
    }
    if (d.event === 'play' || d.event === 'pause' || d.event === 'seeked' || d.event === 'timeupdate') {
        var progress = d.duration ? Math.min(0.99, d.currentTime / d.duration) : 0.05;
        updateContinueWatching(vixsrcCtx.id, vixsrcCtx.title, vixsrcCtx.poster_path, vixsrcCtx.mode, progress, d.currentTime);
    }
});

function openModalAndResume(item) {
    resumeItem = item;
    openModal(item.id, item.mode);
}

/* ── Ricerca ── */
function searchItems(append) {
    var fullInput = qs('searchInput').value.replace(/^\s+|\s+$/g, '').toLowerCase();
    if (!fullInput) return;
    if (!append) { page = 1; qs('movieGrid').innerHTML = ''; currentMovies = []; }
    isFetching = true;
    searchActive = true;
    currentSimilarId = null;
    currentCategoryId = null;
    qs('sectionTitle').style.display = 'block';
    qs('loading').style.display = 'block';
    var myToken = ++requestToken;

    function runSearch(url, titleText) {
        getJSON(url, function (data) {
            if (myToken !== requestToken) return;
            qs('sectionTitle').innerText = titleText;
            currentMovies = append ? currentMovies.concat(data.results) : data.results;
            renderItems(data.results, append);
            qs('loadMoreBtn').style.display = (data.total_pages > page) ? 'block' : 'none';
            qs('loading').style.display = 'none';
            isFetching = false;
        }, function () {
            if (myToken !== requestToken) return;
            qs('loading').style.display = 'none';
            isFetching = false;
        });
    }

    if (searchType === 'actor') {
        getJSON(BASE_URL + '/search/person?api_key=' + API_KEY + '&query=' + encodeURIComponent(fullInput) + '&language=it-IT', function (personData) {
            if (myToken !== requestToken) return;
            if (personData.results && personData.results.length > 0) {
                var actorId = personData.results[0].id;
                runSearch(BASE_URL + '/discover/' + currentMode + '?api_key=' + API_KEY + '&language=it-IT&with_cast=' + actorId + '&sort_by=popularity.desc&page=' + page, 'Opere con: ' + personData.results[0].name);
            } else {
                qs('sectionTitle').innerText = 'Nessun attore trovato';
                qs('loading').style.display = 'none';
                isFetching = false;
            }
        }, function () { qs('loading').style.display = 'none'; isFetching = false; });
    } else {
        var words = fullInput.split(' ');
        var foundMood = findFirst(MOOD_DATA, function (m) {
            for (var k = 0; k < m.keys.length; k++) {
                var key = m.keys[k];
                if (stringContains(fullInput, key) || stringContains(key, fullInput)) return true;
                for (var w = 0; w < words.length; w++) if (words[w].length > 3 && stringContains(key, words[w])) return true;
            }
            return false;
        });
        if (foundMood) {
            var genreFilter = foundMood.genre ? ('&with_genres=' + foundMood.genre) : '';
            var keywordFilter = foundMood.keywords ? ('&with_keywords=' + foundMood.keywords) : '';
            runSearch(BASE_URL + '/discover/' + currentMode + '?api_key=' + API_KEY + '&language=it-IT&sort_by=popularity.desc&page=' + page + genreFilter + keywordFilter, 'Vibes: ' + fullInput.toUpperCase());
        } else {
            runSearch(BASE_URL + '/search/' + currentMode + '?api_key=' + API_KEY + '&language=it-IT&query=' + encodeURIComponent(fullInput) + '&page=' + page, 'Risultati per: ' + fullInput);
        }
    }
}

function loadMore() {
    page++;
    if (currentSimilarId) getSimilar(currentSimilarId, null, currentMode, true);
    else if (currentCategoryId) selectCategory(currentCategoryId, currentCategoryName, true);
    else if (searchActive) searchItems(true);
    else loadContent(true);
}

function renderItems(items, append) {
    var grid = qs('movieGrid');
    grid.className = 'movie-grid';
    qs('sortBarRow').style.display = 'flex';
    qs('sectionTitle').style.display = 'block';
    if (!append) grid.innerHTML = '';
    if (!items || (items.length === 0 && !append)) { grid.innerHTML = '<p style="width:100%;text-align:center;color:#666;margin-top:50px;">Nessun risultato trovato.</p>'; return; }
    for (var index = 0; index < items.length; index++) {
        (function (item, idx) {
            if (!item.poster_path) return;
            var card = document.createElement('div');
            card.className = 'movie-card';
            card.innerHTML = '<img src="https://image.tmdb.org/t/p/w342' + item.poster_path + '" loading="lazy">';
            card.onclick = function () { openModal(item.id, currentMode); };
            grid.appendChild(card);
            setTimeout(function () { card.className += ' show'; }, idx * 20);
        })(items[index], index);
    }
}

/* ── Modale dettaglio ── */
function openModal(id, type) {
    if (document.activeElement && document.activeElement !== document.body) preModalFocus = document.activeElement;
    currentTvId = type === 'tv' ? id : null;
    getJSON(BASE_URL + '/' + type + '/' + id + '?api_key=' + API_KEY + '&language=it-IT&append_to_response=videos,watch/providers', function (data) {
        var title = data.title || data.name;
        var release = data.release_date || data.first_air_date;
        qs('modalTitle').innerText = title;
        qs('modalPlot').innerText = data.overview || "Descrizione non disponibile.";
        qs('modalHero').style.backgroundImage = 'url(https://image.tmdb.org/t/p/w1280' + data.backdrop_path + ')';
        qs('modalRating').innerHTML = '<i class="fa-solid fa-star"></i> ' + (data.vote_average ? data.vote_average.toFixed(1) : 'N/A');
        qs('modalYear').innerText = release ? release.split('-')[0] : 'N/A';
        var genresHtml = '';
        var genres = (data.genres || []).slice(0, 3);
        for (var g = 0; g < genres.length; g++) genresHtml += '<span>' + escapeHtml(genres[g].name) + '</span>';
        qs('modalGenres').innerHTML = genresHtml;

        var trailer = null;
        var videos = (data.videos && data.videos.results) || [];
        for (var v = 0; v < videos.length; v++) {
            if ((videos[v].type === 'Trailer' || videos[v].type === 'Teaser') && videos[v].site === 'YouTube') { trailer = videos[v]; break; }
        }
        currentTrailerKey = trailer ? trailer.key : '';
        qs('trailerTrigger').style.display = trailer ? 'block' : 'none';

        var player = qs('videoPlayer');
        player.style.display = 'none';
        player.innerHTML = '';
        qs('sandboxControl').style.display = 'none';

        var epSelector = qs('epSelector');
        var seasonMenu = qs('seasonMenu');
        var episodeMenu = qs('episodeMenu');
        var cwEntryForSeason = findFirst(continueWatching, function (c) { return c.id === id && c.mode === type; });

        function finishOpen() {
            var cwEntryCheck = findFirst(continueWatching, function (c) { return c.id === id && c.mode === type; });
            var watchBtn = qs('watchNowBtn');
            var restartBtn = qs('restartBtn');
            if (cwEntryCheck && cwEntryCheck.resumeTime > 30) {
                watchBtn.innerHTML = '<i class="fa-solid fa-rotate-right" style="margin-right:8px"></i> RIPRENDI DA ' + formatResumeTime(cwEntryCheck.resumeTime) + ' (Italiano)';
                restartBtn.style.display = 'flex';
            } else {
                watchBtn.innerHTML = '<i class="fa-solid fa-play" style="margin-right:8px"></i> GUARDA ORA (Italiano)';
                restartBtn.style.display = 'none';
            }

            watchBtn.onclick = function () {
                var cwEntry = findFirst(continueWatching, function (c) { return c.id === id && c.mode === type; });
                var startTime = (cwEntry && cwEntry.resumeTime > 30) ? Math.floor(cwEntry.resumeTime) : 0;
                var embedUrl;
                if (type === 'movie') embedUrl = 'https://vixsrc.to/movie/' + id + '?autoplay=true&lang=it' + (startTime ? '&startAt=' + startTime : '');
                else embedUrl = 'https://vixsrc.to/tv/' + id + '/' + selectedSeason + '/' + selectedEpisode + '?autoplay=true&lang=it' + (startTime ? '&startAt=' + startTime : '');
                player.innerHTML = '<iframe src="' + embedUrl + '" frameborder="0" allowfullscreen webkitallowfullscreen mozallowfullscreen allow="autoplay; fullscreen" referrerpolicy="origin"></iframe>';
                player.style.display = 'block';
                requestFullscreenOn(player);
                qs('sandboxControl').style.display = 'none';
                if (startTime > 0) resumeItem = null;
                updateContinueWatching(id, title, data.poster_path || data.backdrop_path, type, cwEntry ? cwEntry.progress : 0.05, cwEntry ? cwEntry.resumeTime : 0, type === 'tv' ? selectedSeason : undefined, type === 'tv' ? selectedEpisode : undefined);
                vixsrcCtx = { id: id, title: title, poster_path: data.poster_path || data.backdrop_path, mode: type, expectedStart: startTime, embedUrl: embedUrl, checked: false, retried: false };
                startProgressTracking(id, title, data.poster_path || data.backdrop_path, type);
                focusEl(watchBtn);
            };

            restartBtn.onclick = function () {
                var embedUrl;
                if (type === 'movie') embedUrl = 'https://vixsrc.to/movie/' + id + '?autoplay=true&lang=it';
                else embedUrl = 'https://vixsrc.to/tv/' + id + '/' + selectedSeason + '/' + selectedEpisode + '?autoplay=true&lang=it';
                player.innerHTML = '<iframe src="' + embedUrl + '" frameborder="0" allowfullscreen webkitallowfullscreen mozallowfullscreen allow="autoplay; fullscreen" referrerpolicy="origin"></iframe>';
                player.style.display = 'block';
                requestFullscreenOn(player);
                qs('sandboxControl').style.display = 'none';
                resumeItem = null;
                updateContinueWatching(id, title, data.poster_path || data.backdrop_path, type, 0.05, 0, type === 'tv' ? selectedSeason : undefined, type === 'tv' ? selectedEpisode : undefined);
                vixsrcCtx = { id: id, title: title, poster_path: data.poster_path || data.backdrop_path, mode: type };
                startProgressTracking(id, title, data.poster_path || data.backdrop_path, type);
                watchBtn.innerHTML = '<i class="fa-solid fa-play" style="margin-right:8px"></i> GUARDA ORA (Italiano)';
                restartBtn.style.display = 'none';
                focusEl(watchBtn);
            };

            qs('watchOriginalBtn').onclick = function () {
                var cwEntry = findFirst(continueWatching, function (c) { return c.id === id && c.mode === type; });
                var startTime = (cwEntry && cwEntry.resumeTime > 30) ? Math.floor(cwEntry.resumeTime) : 0;
                var embedUrl;
                if (type === 'movie') embedUrl = 'https://vidsrc.me/embed/movie?tmdb=' + id + (startTime ? '&t=' + startTime : '');
                else embedUrl = 'https://vidsrc.me/embed/tv?tmdb=' + id + '&season=' + selectedSeason + '&episode=' + selectedEpisode + (startTime ? '&t=' + startTime : '');
                player.innerHTML = '<iframe src="' + embedUrl + '" frameborder="0" allowfullscreen webkitallowfullscreen mozallowfullscreen allow="autoplay; fullscreen" referrerpolicy="origin"></iframe>';
                player.style.display = 'block';
                requestFullscreenOn(player);
                qs('sandboxControl').style.display = 'none';
                if (startTime > 0) resumeItem = null;
                vixsrcCtx = null;
                updateContinueWatching(id, title, data.poster_path || data.backdrop_path, type, cwEntry ? cwEntry.progress : 0.05, cwEntry ? cwEntry.resumeTime : 0, type === 'tv' ? selectedSeason : undefined, type === 'tv' ? selectedEpisode : undefined);
                startProgressTracking(id, title, data.poster_path || data.backdrop_path, type);
                focusEl(qs('watchOriginalBtn'));
            };

            var providers = (data['watch/providers'] && data['watch/providers'].results && data['watch/providers'].results.IT && data['watch/providers'].results.IT.flatrate) || [];
            var pList = qs('platformList');
            if (providers.length) {
                var provHtml = '';
                for (var p = 0; p < providers.length; p++) provHtml += '<img src="https://image.tmdb.org/t/p/w92' + providers[p].logo_path + '" class="platform-logo">';
                pList.innerHTML = provHtml;
            } else {
                pList.innerHTML = '<p style="color:#666; font-size:0.85rem;">Verifica disponibilità locale.</p>';
            }
            qs('similarTrigger').onclick = function () { getSimilar(id, title, type, false); };

            qs('movieModal').className += ' open';
            document.body.style.overflow = 'hidden';
            focusEl(qs('watchNowBtn'), true);
        }

        if (type === 'tv') {
            epSelector.style.display = 'block';
            seasonMenu.innerHTML = '';
            episodeMenu.innerHTML = '';
            var seasons = [];
            var allSeasons = data.seasons || [];
            for (var s = 0; s < allSeasons.length; s++) if (allSeasons[s].season_number > 0) seasons.push(allSeasons[s]);
            for (var s2 = 0; s2 < seasons.length; s2++) {
                (function (sNum) {
                    var mi = document.createElement('div');
                    mi.className = 'menu-item';
                    mi.textContent = 'Stagione ' + sNum;
                    mi.onclick = function () { selectSeason(sNum); };
                    seasonMenu.appendChild(mi);
                })(seasons[s2].season_number);
            }
            selectedSeason = (cwEntryForSeason && cwEntryForSeason.season) ? cwEntryForSeason.season : (seasons.length ? seasons[0].season_number : 1);
            qs('seasonSelectLabel').textContent = 'Stagione ' + selectedSeason;
            loadEpisodes(cwEntryForSeason && cwEntryForSeason.episode ? cwEntryForSeason.episode : null, finishOpen);
        } else {
            epSelector.style.display = 'none';
            finishOpen();
        }
    }, function () {
        qs('loading').style.display = 'none';
    });
}

function toggleEpMenu(kind) {
    var menu = qs(kind === 'season' ? 'seasonMenu' : 'episodeMenu');
    var otherMenu = qs(kind === 'season' ? 'episodeMenu' : 'seasonMenu');
    otherMenu.className = otherMenu.className.replace(' active', '');
    if (menu.className.indexOf('active') > -1) menu.className = menu.className.replace(' active', '');
    else { menu.className += ' active'; focusFirstIn(menu); }
}

function selectSeason(seasonNumber) {
    selectedSeason = seasonNumber;
    qs('seasonSelectLabel').textContent = 'Stagione ' + seasonNumber;
    qs('seasonMenu').className = qs('seasonMenu').className.replace(' active', '');
    loadEpisodes(null, function () { focusEl(qs('seasonSelectBtn')); });
}

function selectEpisode(episodeNumber, label) {
    selectedEpisode = episodeNumber;
    qs('episodeSelectLabel').textContent = label;
    qs('episodeMenu').className = qs('episodeMenu').className.replace(' active', '');
    focusEl(qs('episodeSelectBtn'));
}

function loadEpisodes(preferredEpisode, done) {
    var episodeMenu = qs('episodeMenu');
    if (!currentTvId) { if (done) done(); return; }
    getJSON(BASE_URL + '/tv/' + currentTvId + '/season/' + selectedSeason + '?api_key=' + API_KEY + '&language=it-IT', function (data) {
        episodeMenu.innerHTML = '';
        if (data.episodes && data.episodes.length) {
            for (var i = 0; i < data.episodes.length; i++) {
                (function (ep) {
                    var label = 'Ep. ' + ep.episode_number + ' - ' + ep.name;
                    var mi = document.createElement('div');
                    mi.className = 'menu-item';
                    mi.textContent = label;
                    mi.onclick = function () { selectEpisode(ep.episode_number, label); };
                    episodeMenu.appendChild(mi);
                })(data.episodes[i]);
            }
            var chosen = preferredEpisode ? findFirst(data.episodes, function (e) { return e.episode_number === preferredEpisode; }) : null;
            if (!chosen) chosen = data.episodes[0];
            selectedEpisode = chosen.episode_number;
            qs('episodeSelectLabel').textContent = 'Ep. ' + chosen.episode_number + ' - ' + chosen.name;
        }
        if (done) done();
    }, function () { if (done) done(); });
}

function getSimilar(id, title, type, append) {
    if (!append) {
        closeModal();
        page = 1; currentMovies = []; currentSimilarId = id; searchActive = false;
        qs('movieGrid').innerHTML = '';
        qs('sectionTitle').style.display = 'block';
        qs('sectionTitle').innerText = 'Simili a: ' + title;
        window.scrollTo(0, 0);
    }
    isFetching = true;
    qs('loading').style.display = 'block';
    var myToken = ++requestToken;
    getJSON(BASE_URL + '/' + type + '/' + id + '/recommendations?api_key=' + API_KEY + '&language=it-IT&page=' + page, function (data) {
        if (myToken !== requestToken) return;
        currentMovies = append ? currentMovies.concat(data.results) : data.results;
        renderItems(data.results, append);
        qs('loadMoreBtn').style.display = data.total_pages > page ? 'block' : 'none';
        qs('loading').style.display = 'none';
        isFetching = false;
    }, function () {
        if (myToken !== requestToken) return;
        qs('loading').style.display = 'none';
        isFetching = false;
    });
}

function playTrailer() {
    if (!currentTrailerKey) return;
    var player = qs('videoPlayer');
    player.innerHTML = '<iframe src="https://www.youtube.com/embed/' + currentTrailerKey + '?autoplay=1" allow="autoplay; encrypted-media; fullscreen" allowfullscreen webkitallowfullscreen mozallowfullscreen></iframe>';
    player.style.display = 'block';
    requestFullscreenOn(player);
    qs('sandboxControl').style.display = 'none';
}

function exitFullscreenIfActive() {
    try {
        var fsEl = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;
        if (!fsEl) return;
        if (document.exitFullscreen) document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        else if (document.mozCancelFullScreen) document.mozCancelFullScreen();
        else if (document.msExitFullscreen) document.msExitFullscreen();
    } catch (e) {}
}

function closeVideoPlayer() {
    var player = qs('videoPlayer');
    if (player.style.display === 'none' || player.innerHTML.replace(/^\s+|\s+$/g, '') === '') return false;
    exitFullscreenIfActive();
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    vixsrcCtx = null;
    player.style.display = 'none';
    player.innerHTML = '';
    qs('sandboxControl').style.display = 'none';
    focusEl(qs('watchNowBtn'));
    return true;
}

function closeModal() {
    exitFullscreenIfActive();
    if (progressInterval) { clearInterval(progressInterval); progressInterval = null; }
    vixsrcCtx = null;
    var modal = qs('movieModal');
    modal.className = modal.className.replace(' open', '');
    document.body.style.overflow = 'auto';
    qs('videoPlayer').innerHTML = '';
    qs('videoPlayer').style.display = 'none';
    qs('sandboxControl').style.display = 'none';
    restoreFocusAfterModal();
}

function toggleSandbox() {
    var isChecked = qs('sandboxToggle').checked;
    var iframe = document.querySelector('#videoPlayer iframe');
    var label = qs('statusLabel');
    if (iframe) {
        if (isChecked) {
            iframe.setAttribute('sandbox', 'allow-forms allow-scripts allow-same-origin');
            label.innerText = "ATTIVA";
            label.className = label.className.replace(' off', '');
        } else {
            iframe.removeAttribute('sandbox');
            label.innerText = "DISATTIVA";
            label.className += ' off';
        }
    }
}

function sortContent(type, chipEl) {
    var chips = document.querySelectorAll('.sort-chip');
    for (var i = 0; i < chips.length; i++) chips[i].className = chips[i].className.replace(' active', '');
    if (chipEl) chipEl.className += ' active';
    if (type === 'date') {
        currentMovies.sort(function (a, b) { return new Date(b.release_date || b.first_air_date) - new Date(a.release_date || a.first_air_date); });
    } else if (type === 'rating') {
        currentMovies.sort(function (a, b) { return b.vote_average - a.vote_average; });
    } else {
        currentMovies.sort(function (a, b) { return b.popularity - a.popularity; });
    }
    renderItems(currentMovies, false);
}

/* ============================================================================
   NAVIGAZIONE A TELECOMANDO (frecce, OK, Indietro) — integrata direttamente,
   senza bisogno di MutationObserver: le funzioni di focus vengono chiamate
   nel punto esatto in cui si aprono/chiudono modale e menu.
   ============================================================================ */
var preModalFocus = null;

function isVisible(el) {
    if (!el) return false;
    var rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : el.currentStyle;
    if (style && (style.visibility === 'hidden' || style.display === 'none')) return false;
    return true;
}

function isFocusCandidate(el) {
    if (!el || el.getAttribute('disabled')) return false;
    var tag = el.tagName;
    if (tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return el.type !== 'hidden';
    if (el.getAttribute('onclick')) return true;
    if (typeof el.onclick === 'function') return true;
    return false;
}

function getActiveLayer() {
    var activeMenu = document.querySelector('.search-menu.active');
    if (activeMenu) return activeMenu;
    var modal = qs('movieModal');
    if (modal && modal.className.indexOf('open') > -1) return modal;
    return document.body;
}

function getFocusables(root) {
    var all = root.querySelectorAll('*');
    var out = [];
    for (var i = 0; i < all.length; i++) {
        if (isFocusCandidate(all[i]) && isVisible(all[i])) out.push(all[i]);
    }
    return out;
}

function currentFocused(root) {
    var active = document.activeElement;
    if (active && active !== document.body && root.contains(active)) return active;
    return null;
}

function rectCenter(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

function findNext(direction, curEl, candidates) {
    var curRect = curEl.getBoundingClientRect();
    var curC = rectCenter(curRect);
    function scoreAll(strict) {
        var best = null, bestScore = Infinity;
        for (var i = 0; i < candidates.length; i++) {
            var el = candidates[i];
            if (el === curEl) continue;
            var r = el.getBoundingClientRect();
            var c = rectCenter(r);
            var dx = c.x - curC.x, dy = c.y - curC.y;
            var primary, perpendicular, inDir;
            if (direction === 'left') { primary = -dx; perpendicular = dy; inDir = r.right <= curRect.left + 2; }
            else if (direction === 'right') { primary = dx; perpendicular = dy; inDir = r.left >= curRect.right - 2; }
            else if (direction === 'up') { primary = -dy; perpendicular = dx; inDir = r.bottom <= curRect.top + 2; }
            else { primary = dy; perpendicular = dx; inDir = r.top >= curRect.bottom - 2; }
            if (strict && !inDir) continue;
            if (primary <= (strict ? 0 : 2)) continue;
            var score = primary + Math.abs(perpendicular) * 2.2;
            if (score < bestScore) { bestScore = score; best = el; }
        }
        return best;
    }
    return scoreAll(true) || scoreAll(false);
}

function tryEnterCardAction(curEl, direction) {
    if (direction !== 'up' || !curEl.querySelector) return null;
    var action = curEl.querySelector('.home-card-del');
    return (action && isVisible(action)) ? action : null;
}
function tryExitCardAction(curEl, direction) {
    if (direction !== 'down' || !curEl.className) return null;
    if (curEl.className.indexOf('home-card-del') === -1) return null;
    var p = curEl.parentNode;
    while (p && p !== document.body) {
        if (p.className && (p.className.indexOf('movie-card') > -1 || p.className.indexOf('home-card') > -1)) return p;
        p = p.parentNode;
    }
    return null;
}

function ensureTabbable(el) {
    if (!el.getAttribute('tabindex') && el.tagName !== 'A' && el.tagName !== 'BUTTON' && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') {
        el.setAttribute('tabindex', '-1');
    }
}

function focusEl(el, isModalOpen) {
    if (!el) return;
    ensureTabbable(el);
    var prev = document.querySelectorAll('.tv-focused');
    for (var i = 0; i < prev.length; i++) prev[i].className = prev[i].className.replace(' tv-focused', '').replace('tv-focused', '');
    el.className += ' tv-focused';
    try { el.focus(); } catch (e) {}
    if (el.scrollIntoView) {
        try { el.scrollIntoView({ block: isModalOpen ? 'start' : 'center', inline: 'nearest' }); } catch (e2) { el.scrollIntoView(); }
    }
}

function focusFirstIn(container) {
    var first = container.querySelector('.menu-item');
    if (first) focusEl(first);
}

function move(direction) {
    var root = getActiveLayer();
    var cur = currentFocused(root);
    var candidates = getFocusables(root);
    if (!candidates.length) return;
    if (!cur) { focusEl(candidates[0]); return; }
    var childAction = tryEnterCardAction(cur, direction);
    if (childAction) { focusEl(childAction); return; }
    var parentCard = tryExitCardAction(cur, direction);
    if (parentCard) { focusEl(parentCard); return; }
    var next = findNext(direction, cur, candidates);
    if (next) focusEl(next);
}

function activate() {
    var root = getActiveLayer();
    var cur = currentFocused(root) || document.activeElement;
    if (!cur || cur === document.body) return;
    if (cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') return;
    if (cur.click) cur.click();
}

function restoreFocusAfterModal() {
    if (preModalFocus && document.body.contains(preModalFocus)) {
        var toFocus = preModalFocus;
        preModalFocus = null;
        setTimeout(function () { focusEl(toFocus); }, 30);
    } else {
        preModalFocus = null;
    }
}

function goBack() {
    var activeMenu = document.querySelector('.search-menu.active');
    if (activeMenu) {
        activeMenu.className = activeMenu.className.replace(' active', '');
        var trigger = qs('menuTrigger');
        if (activeMenu.id === 'seasonMenu') trigger = qs('seasonSelectBtn');
        else if (activeMenu.id === 'episodeMenu') trigger = qs('episodeSelectBtn');
        focusEl(trigger);
        return;
    }
    if (closeVideoPlayer()) return;
    var modal = qs('movieModal');
    if (modal && modal.className.indexOf('open') > -1) { closeModal(); return; }
    if (currentView !== 'home' || currentMode !== 'movie') switchMode('movie');
}

var DIRECTION_KEYS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
var DIRECTION_KEYCODES = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
var ENTER_KEYCODES = [13, 32, 415];
var BACK_KEYCODES = [27, 10009, 461, 10182];

document.addEventListener('keydown', function (e) {
    var key = e.key || '';
    var keyCode = e.keyCode || 0;
    var dir = DIRECTION_KEYS[key] || DIRECTION_KEYCODES[keyCode];
    var isEnter = key === 'Enter' || key === ' ' || ENTER_KEYCODES.indexOf(keyCode) > -1;
    var isBack = key === 'Escape' || BACK_KEYCODES.indexOf(keyCode) > -1 || (keyCode === 8 && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA');

    var active = document.activeElement;
    var editing = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');

    if (dir) {
        if (editing) {
            if (dir === 'left' || dir === 'right') return;
            e.preventDefault();
            move(dir);
            return;
        }
        e.preventDefault();
        move(dir);
        return;
    }
    if (isEnter) {
        if (editing) return;
        e.preventDefault();
        activate();
        return;
    }
    if (isBack) {
        if (editing) { active.blur(); return; }
        e.preventDefault();
        goBack();
        return;
    }
});

/* ── Collegamento eventi statici (bottoni definiti nell'HTML) ── */
function bindStaticEvents() {
    qs('menuTrigger').onclick = function (e) { e.stopPropagation(); toggleSearchMenu(); };
    var menuItems = document.querySelectorAll('#searchMenu .menu-item');
    menuItems[0].onclick = function (e) { e.stopPropagation(); setSearchMode('vibes'); menuItems[0].className += ' selected'; };
    menuItems[1].onclick = function (e) { e.stopPropagation(); setSearchMode('actor'); menuItems[1].className += ' selected'; };
    menuItems[2].onclick = function (e) { e.stopPropagation(); showCategoryMenu(); };

    var chips = document.querySelectorAll('.sort-chip');
    for (var i = 0; i < chips.length; i++) {
        (function (chip) {
            chip.onclick = function () { sortContent(chip.getAttribute('data-sort'), chip); };
        })(chips[i]);
    }

    qs('tvBtn').onclick = function () { switchMode('tv'); };
    qs('homeBtn').onclick = function () { switchMode('movie'); };
    qs('loadMoreBtn').onclick = function () { loadMore(); };
    qs('modalCloseBtn').onclick = function () { closeModal(); };
    qs('sandboxToggle').onchange = function () { toggleSandbox(); };
    qs('trailerTrigger').onclick = function () { playTrailer(); };
    qs('seasonSelectBtn').onclick = function (e) { e.stopPropagation(); toggleEpMenu('season'); };
    qs('episodeSelectBtn').onclick = function (e) { e.stopPropagation(); toggleEpMenu('episode'); };

    qs('searchInput').addEventListener('keypress', function (e) {
        if (e.key === 'Enter' || e.keyCode === 13) { qs('searchInput').blur(); searchItems(false); }
    });

    window.onclick = function (event) {
        if (!(event.target.className && event.target.className.indexOf && event.target.className.indexOf('menu-trigger') > -1) && event.target.tagName !== 'I') {
            closeSearchMenu();
            closeCategoryMenu();
        }
        qs('seasonMenu').className = qs('seasonMenu').className.replace(' active', '');
        qs('episodeMenu').className = qs('episodeMenu').className.replace(' active', '');
    };

    window.open = function () { return null; };

    var userInteracting = false;
    var interactionTimer = null;
    function markInteraction() {
        userInteracting = true;
        clearTimeout(interactionTimer);
        interactionTimer = setTimeout(function () { userInteracting = false; }, 800);
    }
    document.addEventListener('mousedown', markInteraction, true);
    document.addEventListener('touchstart', markInteraction, true);
    setInterval(function () {
        var player = qs('videoPlayer');
        if (player && player.style.display !== 'none') {
            if (document.activeElement && document.activeElement.tagName === 'IFRAME' && !userInteracting) {
                window.focus();
                document.activeElement.blur();
            }
        }
    }, 50);

    window.addEventListener('beforeunload', function (e) {
        if (qs('videoPlayer').style.display !== 'none') {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    });

    window.addEventListener('offline', function () { qs('appOfflineIndicator').className += ' show'; });
    window.addEventListener('online', function () { qs('appOfflineIndicator').className = qs('appOfflineIndicator').className.replace(' show', ''); });
}

/* ── Avvio ── */
function init() {
    bindStaticEvents();
    window.scrollTo(0, 0);
    loadContent(false);
    setTimeout(function () {
        var candidates = getFocusables(document.body);
        if (candidates.length) focusEl(candidates[0]);
    }, 1200);

    var popularDayKeyRef = getPopularDayKey();
    setInterval(function () {
        var newKey = getPopularDayKey();
        if (newKey !== popularDayKeyRef) {
            popularDayKeyRef = newKey;
            if (currentView === 'home') loadContent(false);
        }
    }, 5 * 60 * 1000);
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 0);
} else {
    document.addEventListener('DOMContentLoaded', init);
}
