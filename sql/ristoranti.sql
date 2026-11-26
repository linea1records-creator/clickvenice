-- v3.74 Ristoranti convenzionati (già applicato su Supabase con le migrazioni menu_piatti_del_giorno e ordini_ristorante)
-- tabelle: rest_admins (rest, profile_id), menu_items (piatti del giorno: nome, descr, prezzo, disponibile, giorno)
-- funzioni: rest_is_admin, menu_oggi(p_token, p_rest), menu_admin(p_token, p_rest, p_azione add|upd|stato|del|copia, p_dati),
--           ordini_rest(p_token, p_rest, p_nomi[]), ordine_stato(p_token, p_rest, p_id, p_stato)
-- tropss è admin di tutti i ristoranti; altri admin: insert into rest_admins(rest, profile_id) values ('sanmarco', <id profilo>);
-- partner sulla mappa: Ristorazione San Marco, Punta della Dogana, order_rest = 'sanmarco'

-- v3.76 tropss gestisce i professionisti: pro_admin_salva(p_token, p_data) modifica o inserisce un servizio assegnandolo
-- a un profilo esistente (utente) o creandolo con PIN; pro_admin_utenti(p_token, p_q) cerca i profili

-- v3.77 Barketplace (Marketplace → ⚓ Barketplace): tabelle bk_barche, bk_offerte; funzioni bk_lista, bk_dettaglio, bk_offri,
-- bk_reclama, bk_azione, bk_reclami; edge function "barca" per pubblicare con foto. Link QR: clickvenice.com/#barca=ID

-- v3.93 catalogo Barketplace: bk_barche + categoria (barca|motore|elica|accessorio), sottocat, marca, modello, specs jsonb;
-- catalogo in catalogo-barche.json (barche per cantiere e modello, motori, eliche, accessori, valori dei filtri)
