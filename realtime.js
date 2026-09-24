/* ============================================================
   MoodMovie — realtime.js
   Piccolo wrapper attorno al client Realtime di Supabase (via CDN, nessun
   bundler in questo progetto — stesso pattern di cloud.js). Serve solo ad
   avvisare index.html quando la riga sync_data del codice corrente viene
   modificata da un altro dispositivo, così non serve più interrogare il
   server a intervalli fissi: si scarica qualcosa solo quando c'è davvero
   un aggiornamento (vedi pollSync in index.html).

   Nessun dato dell'app transita da qui: il payload dei messaggi Postgres
   Changes viene ignorato (i nostri campi superano il limite di 64 byte per
   valore incluso nel messaggio), viene usato solo come "campanello" per
   dire a index.html "controlla, qualcosa è cambiato".
   ============================================================ */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let _client = null;
let _channel = null;
let _subscribedCode = null;

window.MoodRealtime = {
    subscribe(supabaseUrl, supabaseKey, code, onRowChanged) {
        if (!supabaseUrl || !supabaseKey || !code) return;
        if (_channel && _subscribedCode === code) return; // già sottoscritto a questo codice

        if (_channel) { this.unsubscribe(); }
        if (!_client) _client = createClient(supabaseUrl, supabaseKey);

        _channel = _client
            .channel('sync_data_' + code)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'sync_data', filter: `code=eq.${code}` },
                () => { try { onRowChanged(); } catch (e) { /* ignorato: un errore qui non deve rompere il realtime */ } }
            )
            .subscribe();
        _subscribedCode = code;
    },

    unsubscribe() {
        if (_channel && _client) _client.removeChannel(_channel);
        _channel = null;
        _subscribedCode = null;
    }
};
