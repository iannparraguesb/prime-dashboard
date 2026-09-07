-- Ventana de analisis. El contenido anterior NO se borra: los snapshots son el
-- registro historico y borrarlos destruye la posibilidad de recalcular sobre
-- ellos, que es para lo que existe el diseno append-only. Se acota la ventana,
-- que da el mismo resultado en pantalla y se revierte cambiando una fila.
--
-- Aplica tambien a la MEDIANA BASE, no solo a la lista: acotar a 12 meses bajo
-- la mediana de reels de 0,2367% a 0,1831%, porque el contenido viejo se
-- guardaba mas. Si la base incluyera 2023, las piezas recientes se compararian
-- contra otra epoca de la cuenta, con otro tamano de audiencia y otro mensaje.
--
-- Efecto: de 302 piezas quedan 176 en ventana (168 aptas para ranking).
-- La migracion completa esta aplicada en el proyecto; este archivo la refleja.
insert into config (clave, valor, nota) values
  ('ventana_meses', 12,
   'Meses hacia atras que entran al analisis. El contenido anterior sigue en la base pero no entra a rankings ni a medianas: la cuenta cambio de mensaje y de tamano, asi que comparar contra 2023 mide otra cosa.')
on conflict (clave) do update set valor = excluded.valor, nota = excluded.nota;

-- Las 5 vistas se recrean agregando `en_ventana` y sumandola a `apto_ranking`.
-- Ver el cuerpo completo en la migracion aplicada `ventana_de_analisis_12_meses`
-- (mismo contenido que 0004 mas la clausula de ventana).
