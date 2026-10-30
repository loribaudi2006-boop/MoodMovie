/* ============================================================
   MoodMovie — realtime.js
   Piccolo wrapper attorno al client Realtime di Supabase (via CDN, nessun
   bundler in questo progetto — stesso pattern di cloud.js). Serve solo ad
   avvisare index.html quando i dati del codice corrente vengono modificati
   da un altro dispositivo, così non serve interrogare il server a
   intervalli fissi (vedi pollSync in index.html).

   v28: le tabelle non sono piu' leggibili da fuori, quindi niente "Postgres
   Changes": ogni dispositivo che salva suona un "campanello" (Broadcast) sul
   canale del proprio codice; gli altri dispositivi con lo stesso codice lo
   sentono e controllano. Nel messaggio non viaggia nessun dato.
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let _client = null;
let _channel = null;
let _subscribedCode = null;
let _cfg = null;

const topic = (code) => 'mmsync-' + code;

window.MoodRealtime = {
    subscribe(supabaseUrl, supabaseKey, code, onRowChanged) {
        if (!supabaseUrl || !supabaseKey || !code) return;
        _cfg = { url: supabaseUrl, key: supabaseKey };
        if (_channel && _subscribedCode === code) return; // già sottoscritto a questo codice

        if (_channel) { this.unsubscribe(); }
        if (!_client) _client = createClient(supabaseUrl, supabaseKey);

        _channel = _client
            .channel(topic(code), { config: { broadcast: { self: false } } })
            .on('broadcast', { event: 'changed' }, () => { try { onRowChanged(); } catch (e) { /* un errore qui non deve rompere il realtime */ } })
            .subscribe();
        _subscribedCode = code;
    },

    // avvisa gli altri dispositivi con lo stesso codice che c'e' qualcosa di nuovo
    ping(code) {
        if (!code) return;
        try {
            if (_channel && _subscribedCode === code) { _channel.send({ type: 'broadcast', event: 'changed', payload: {} }); return; }
            if (!_cfg) return;
            if (!_client) _client = createClient(_cfg.url, _cfg.key);
            const ch = _client.channel(topic(code));
            Promise.resolve(ch.send({ type: 'broadcast', event: 'changed', payload: {} })).finally(() => _client.removeChannel(ch));
        } catch (e) { /* il campanello e' solo un aiuto: il controllo di sicurezza recupera comunque */ }
    },

    unsubscribe() {
        if (_channel && _client) _client.removeChannel(_channel);
        _channel = null;
        _subscribedCode = null;
    }
};
