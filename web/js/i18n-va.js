// Traducció al valencià de la interfície (normativa de l'AVL, registre formal).
// Clau: el text en castellà tal com apareix en el codi. Els marcadors {nom} s'han de mantindre.
export const VA = {
  // ---------------------------------------------------------------- navegació, capçalera i peu
  "Preguntar": "Preguntar",
  "Comparar": "Comparar",
  "Corpus": "Corpus",
  "Mapa semántico": "Mapa semàntic",
  "Evaluación": "Avaluació",
  "Arquitecturas": "Arquitectures",
  "Secciones": "Seccions",
  "Idioma": "Idioma",
  "Cambiar tema": "Canvia el tema",
  "Pregunta al Diario.": "Pregunta al Diari.",
  "Entiende": "Entén",
  "cómo responde.": "com respon.",
  "Laboratorio de investigación de ValgrAI para comparar arquitecturas RAG sobre las disposiciones del Diari Oficial de la Generalitat Valenciana.":
    "Laboratori d'investigació de ValgrAI per a comparar arquitectures RAG sobre les disposicions del Diari Oficial de la Generalitat Valenciana.",
  "Proyecto académico, no es un servicio oficial. Datos públicos del": "Projecte acadèmic, no és un servici oficial. Dades públiques del",
  "; las respuestas se generan automáticamente: consulte siempre el texto oficial.": "; les respostes es generen automàticament: consulteu sempre el text oficial.",
  "Generalitat Valenciana · IVACE+i, Instituto Valenciano de Competitividad e Innovación · Financiado por la Unión Europea":
    "Generalitat Valenciana · IVACE+i, Institut Valencià de Competitivitat i Innovació · Finançat per la Unió Europea",
  "Preparando el laboratorio": "Preparant el laboratori",
  "Conectando…": "Connectant…",
  "Esperando al servidor…": "Esperant el servidor…",
  "Revisa la consola del servidor y {file}.": "Reviseu la consola del servidor i {file}.",

  // ---------------------------------------------------------------- LLM
  "Solo retrieval": "Només retrieval",
  "Conectado: {name}": "Connectat: {name}",
  "Sin LLM: {error}": "Sense LLM: {error}",
  "vacío = primer modelo del servidor": "buit = primer model del servidor",
  "opcional · se guarda solo en memoria del servidor": "opcional · només es guarda en la memòria del servidor",
  "nombre de la variable de entorno": "nom de la variable d'entorn",
  "Conectado": "Connectat",
  "Sin conexión": "Sense connexió",
  "Modo solo retrieval: se muestran los fragmentos recuperados.": "Mode només retrieval: es mostren els fragments recuperats.",
  "LLM conectado": "LLM connectat",
  "No se pudo conectar": "No s'ha pogut connectar",
  "Conectar": "Connecta",
  "Ajustes": "Configuració",
  "Modelo generativo": "Model generatiu",
  "Cualquier servidor con API tipo OpenAI. Sin LLM el laboratorio funciona en modo solo retrieval: Corrective no puede reformular y no se generan respuestas.":
    "Qualsevol servidor amb API de tipus OpenAI. Sense LLM, el laboratori funciona en mode només retrieval: Corrective no pot reformular i no es generen respostes.",
  "URL base": "URL base",
  "Modelo": "Model",
  "Variable de entorno con la clave": "Variable d'entorn amb la clau",
  "o clave directa": "o clau directa",
  "Cerrar": "Tanca",

  // ---------------------------------------------------------------- capçaleres de secció
  "Pregunta al *DOGV*": "Pregunta al *DOGV*",
  "Compara *arquitecturas*": "Compara *arquitectures*",
  "El *corpus*": "El *corpus*",
  "Mapa *semántico*": "Mapa *semàntic*",
  "¿Qué *recupera* cada una?": "Què *recupera* cadascuna?",
  "Familias de *RAG*": "Famílies de *RAG*",

  // ---------------------------------------------------------------- arquitectures
  "Naive": "Naive",
  "Híbrido": "Híbrid",
  "Advanced": "Advanced",
  "Corrective": "Corrective",
  "Chunks de tamaño fijo, retrieval denso top-k y generación.": "Chunks de grandària fixa, retrieval dens top-k i generació.",
  "Ablation: BM25 + denso con RRF sobre chunks estructurales, sin reranker.": "Ablation: BM25 + dens amb RRF sobre chunks estructurals, sense reranker.",
  "Híbrido BM25 + denso (RRF), reranking con cross-encoder y reordenación del contexto.": "Híbrid BM25 + dens (RRF), reranking amb cross-encoder i reordenació del context.",
  "Advanced + evaluador de relevancia: reformula (multi-query + HyDE) o se abstiene.": "Advanced + avaluador de rellevància: reformula (multi-query + HyDE) o s'absté.",

  // ---------------------------------------------------------------- narració de l'execució
  "Consulta": "Consulta",
  "Llega la pregunta a {name}.": "La pregunta arriba a {name}.",
  "Prefiltro por metadatos ({f}): quedan {n} de {total} chunks.": "Prefiltre per metadades ({f}): queden {n} de {total} chunks.",
  "Se busca en los {n} chunks del índice «{index}».": "Es busca en els {n} chunks de l'índex «{index}».",
  "Se codifica también la consulta alternativa {q} ({ms}).": "També es codifica la consulta alternativa {q} ({ms}).",
  "El bi-encoder convierte la consulta en un vector de {dim} dimensiones ({ms}). Consulta y chunks viven en el mismo espacio: la cercanía es similitud semántica.":
    "El bi-encoder convertix la consulta en un vector de {dim} dimensions ({ms}). La consulta i els chunks viuen en el mateix espai: la proximitat és similitud semàntica.",
  "Denso": "Dens",
  "Similitud coseno contra todos los chunks: el mejor obtiene {s}. Encuentra paráfrasis y sinónimos, pero puede fallar con códigos, nombres propios o cifras.":
    "Similitud cosinus amb tots els chunks: el millor obté {s}. Troba paràfrasis i sinònims, però pot fallar amb codis, noms propis o xifres.",
  "La consulta queda en {n} términos ({tokens}). {hits} chunks contienen alguno; BM25 premia los términos raros (IDF) y penaliza los chunks largos.":
    "La consulta queda en {n} termes ({tokens}). {hits} chunks en contenen algun; BM25 premia els termes poc freqüents (IDF) i penalitza els chunks llargs.",
  "ninguno": "cap",
  "Reciprocal Rank Fusion suma {formula} de {n} listas. Solo cuenta la posición, no la escala del score. {both} de los {top} primeros aparecen en más de una lista.":
    "Reciprocal Rank Fusion suma {formula} de {n} llistes. Només compta la posició, no l'escala del score. {both} dels {top} primers apareixen en més d'una llista.",
  "rango": "posició",
  " para el reranker. Ahora el cross-encoder lee {n} pares (consulta, chunk): es la etapa más cara{cpu}…":
    " per al reranker. Ara el cross-encoder llig {n} parells (consulta, chunk): és l'etapa més costosa{cpu}…",
  ", en CPU puede tardar decenas de segundos": "; en CPU pot tardar desenes de segons",
  "Candidatos": "Candidats",
  "Se eliminan textos duplicados y se conservan los {n} mejores candidatos": "S'eliminen els textos duplicats i es conserven els {n} millors candidats",
  "El cross-encoder lee cada par (consulta, chunk) completo, más caro pero más preciso: {ms}. El nuevo #1 (score {s}) venía del puesto {prev} de RRF; {moved} candidatos cambian de posición.":
    "El cross-encoder llig cada parell (consulta, chunk) complet, més costós però més precís: {ms}. El nou #1 (score {s}) venia de la posició {prev} de RRF; {moved} candidats canvien de posició.",
  "Corrección": "Correcció",
  "El mejor score del reranker no alcanza {tau}: el retrieval se considera {amb} y el LLM reformula la pregunta…":
    "El millor score del reranker no arriba a {tau}: el retrieval es considera {amb} i l'LLM reformula la pregunta…",
  "ambiguo": "ambigu",
  "HyDE: el LLM escribe un párrafo hipotético con el estilo del DOGV; su embedding se usa como consulta densa extra.":
    "HyDE: l'LLM escriu un paràgraf hipotètic amb l'estil del DOGV; el seu embedding s'usa com a consulta densa addicional.",
  "Generación": "Generació",
  "Se envían {n} fragmentos numerados al LLM con la instrucción de citar [n] y no inventar…":
    "S'envien {n} fragments numerats a l'LLM amb la instrucció de citar [n] i no inventar res…",
  "Reformulaciones: {list}.": "Reformulacions: {list}.",
  "Párrafo hipotético: «{text}»": "Paràgraf hipotètic: «{text}»",
  "Respuesta generada en {ms}.": "Resposta generada en {ms}.",
  "El evaluador decide {a}: ni tras reformular hay evidencia suficiente.": "L'avaluador decidix {a}: ni després de reformular hi ha prou evidència.",
  "abstenerse": "abstindre's",
  "Tras la segunda pasada el mejor score es {s}.": "Després de la segona passada, el millor score és {s}.",
  "Fin": "Fi",
  "Listo en {ms} con {n} fragmentos en el contexto.": "Fet en {ms} amb {n} fragments en el context.",
  "(Sin generación: modo solo retrieval.)": "(Sense generació: mode només retrieval.)",

  // ---------------------------------------------------------------- Preguntar
  "(sin título)": "(sense títol)",
  "Ver menos": "Mostra'n menys",
  "Ver fragmento": "Mostra el fragment",
  "Abrir disposición": "Obri la disposició",
  "Abrir en RAG Lab": "Obri en RAG Lab",
  "Pregunta lo que quieras sobre el DOGV…": "Pregunta el que vulgues sobre el DOGV…",
  "Pregunta": "Pregunta",
  "Filtros": "Filtres",
  "Parámetros": "Paràmetres",
  "Todos": "Tots",
  "Organismo": "Organisme",
  "Sección": "Secció",
  "Desde": "Des de",
  "Hasta": "Fins a",
  "Nº de DOGV": "Núm. de DOGV",
  "Los filtros se aplican antes de buscar (prefiltrado): el retrieval solo ve los chunks que cumplen las condiciones.":
    "Els filtres s'apliquen abans de buscar (prefiltratge): el retrieval només veu els chunks que complixen les condicions.",
  "Filtros · {n}": "Filtres · {n}",
  "Fragmentos al LLM (top-k)": "Fragments a l'LLM (top-k)",
  "Presupuesto de contexto (car.)": "Pressupost de context (car.)",
  "Peso rama densa (RRF)": "Pes de la branca densa (RRF)",
  "Peso rama BM25 (RRF)": "Pes de la branca BM25 (RRF)",
  "Constante k de RRF": "Constant k de RRF",
  "Candidatos al reranker": "Candidats al reranker",
  "Chunks vecinos (small-to-big)": "Chunks veïns (small-to-big)",
  "τ_ok (retrieval correcto)": "τ_ok (retrieval correcte)",
  "τ_abstain (abstención)": "τ_abstain (abstenció)",
  "Reformulaciones": "Reformulacions",
  "Reordenar (lost in the middle)": "Reordena (lost in the middle)",
  "Usar HyDE": "Usa HyDE",
  "Idioma de la respuesta": "Idioma de la resposta",
  "Valenciano": "Valencià",
  "Castellano": "Castellà",
  "Los cambios solo afectan a tus consultas desde esta página; no modifican la configuración del notebook.":
    "Els canvis només afecten les teues consultes des d'esta pàgina; no modifiquen la configuració del notebook.",
  "Parámetros restablecidos": "Paràmetres restablits",
  "Restablecer": "Restablix",
  "Usa el título de una disposición al azar como consulta": "Usa el títol d'una disposició a l'atzar com a consulta",
  "Título al azar": "Títol a l'atzar",
  "Recientes:": "Recents:",
  "cargando el espacio semántico…": "carregant l'espai semàntic…",
  "{n} fragmentos reales · consulta y 6 vecinos": "{n} fragments reals · consulta i 6 veïns",
  "Mira cómo cada arquitectura RAG busca, filtra y razona sobre {n} disposiciones del {from} al {to}.":
    "Mira com cada arquitectura RAG busca, filtra i raona sobre {n} disposicions del {from} al {to}.",
  "Conecta un LLM desde el botón de la barra superior": "Connecta un LLM des del botó de la barra superior",
  "Generar respuesta": "Genera la resposta",
  "Sin LLM · solo retrieval": "Sense LLM · només retrieval",
  "Preparando…": "Preparant…",
  "Paso a paso": "Pas a pas",
  "Paso anterior": "Pas anterior",
  "Paso siguiente": "Pas següent",
  "Detener": "Para",
  "Buscando…": "Buscant…",
  "Los fragmentos aparecerán aquí.": "Els fragments apareixeran ací.",
  "Respuesta": "Resposta",
  "Fuentes": "Fonts",
  "En el orden en que entran al prompt": "En l'ordre en què entren al prompt",
  "Dentro del retrieval": "Dins del retrieval",
  "Pasa el ratón por cualquier elemento para ver el chunk": "Passa el ratolí per qualsevol element per a veure el chunk",
  "Recorrido de candidatos": "Recorregut dels candidats",
  "Top 12 de cada etapa. Las líneas unen el mismo chunk; en color, los que acaban en el contexto. Una línea discontinua desde abajo indica que venía de fuera del top 12.":
    "Top 12 de cada etapa. Les línies unixen el mateix chunk; en color, els que acaben en el context. Una línia discontínua des de baix indica que venia de fora del top 12.",
  "Ejecución": "Execució",
  "Eventos reales del servidor, en directo": "Esdeveniments reals del servidor, en directe",
  "coseno · {ms}": "cosinus · {ms}",
  "{n} con términos": "{n} amb termes",
  "error": "error",
  "top-{n} · [n] en el prompt": "top-{n} · [n] en el prompt",
  "Total": "Total",
  "El sistema se abstiene": "El sistema s'absté",
  "Modo solo retrieval: no se ha generado respuesta.": "Mode només retrieval: no s'ha generat cap resposta.",
  "Conecta un LLM desde la barra superior o activa «Generar respuesta». Debajo tienes los fragmentos que recibiría.":
    "Connecta un LLM des de la barra superior o activa «Genera la resposta». Davall tens els fragments que rebria.",
  "Comprobar fundamentación": "Comprova la fonamentació",
  "Fundamentación": "Fonamentació",
  "Contexto": "Context",
  "{n} car.": "{n} car.",
  "Veredicto": "Veredicte",
  "correcto": "correcte",
  "abstención": "abstenció",
  "Ver el prompt exacto": "Mostra el prompt exacte",
  "Ningún fragmento supera los filtros.": "Cap fragment no passa els filtres.",
  "La consulta": "La consulta",
  "Vector denso": "Vector dens",
  "{dim} dimensiones (se muestran {n}). Azul: negativo, naranja: positivo. Los vectores están normalizados (norma {norm}), así que el producto escalar es el coseno.":
    "{dim} dimensions (se'n mostren {n}). Blau: negatiu; taronja: positiu. Els vectors estan normalitzats (norma {norm}), de manera que el producte escalar és el cosinus.",
  "Términos BM25": "Termes BM25",
  "Tras plegar acentos, quitar stopwords y aplicar stemming Snowball. Así se compara con el índice léxico.":
    "Després de llevar accents i paraules buides i aplicar stemming Snowball. Així es compara amb l'índex lèxic.",
  "Términos presentes en los mejores chunks BM25": "Termes presents en els millors chunks BM25",
  "Términos (frecuencia)": "Termes (freqüència)",
  "La arquitectura naive no usa BM25: solo la rama densa.": "L'arquitectura naive no usa BM25: només la branca densa.",
  "Denso vs BM25": "Dens vs. BM25",
  "similitud densa (coseno)": "similitud densa (cosinus)",
  "score BM25": "score BM25",
  "Cada punto es un candidato de la fusión. El tamaño es su score RRF; con borde, los que acaban en el contexto.":
    "Cada punt és un candidat de la fusió. La grandària és el seu score RRF; amb vora, els que acaben en el context.",
  "en ambas listas": "en les dos llistes",
  "solo denso": "només dens",
  "solo BM25": "només BM25",
  "Los puntos sobre el eje horizontal solo los encuentra la rama densa (paráfrasis, sinónimos); los del eje vertical, solo BM25 (códigos, nombres, cifras exactas). RRF premia a los que están arriba en las dos.":
    "Els punts sobre l'eix horitzontal només els troba la branca densa (paràfrasis, sinònims); els de l'eix vertical, només BM25 (codis, noms, xifres exactes). RRF premia els que estan amunt en les dos.",
  "Los scores densos de este modelo se concentran en un rango estrecho (aquí desde {min}): por eso RRF fusiona por posición y no por valor.":
    "Els scores densos d'este model es concentren en un interval estret (ací des de {min}): per això RRF fusiona per posició i no per valor.",
  "Evaluador (CRAG)": "Avaluador (CRAG)",
  "Scores del reranker": "Scores del reranker",
  "Reranker {s} · antes #{prev}": "Reranker {s} · abans #{prev}",
  "ambiguo → reformula": "ambigu → reformula",
  "Puerta de relevancia": "Porta de rellevància",
  "Corrective RAG usa el mejor score del reranker como evaluador. Los umbrales dependen del reranker y hay que calibrarlos con preguntas reales.":
    "Corrective RAG usa el millor score del reranker com a avaluador. Els llindars depenen del reranker i cal calibrar-los amb preguntes reals.",
  "Correcto: se usa el contexto tal cual": "Correcte: s'usa el context tal com està",
  "Ambiguo: se reformula y se busca otra vez": "Ambigu: es reformula i es torna a buscar",
  "Incorrecto: se abstiene": "Incorrecte: s'absté",
  "evaluando…": "avaluant…",
  "sin LLM no se puede reformular la consulta": "sense LLM no es pot reformular la consulta",
  "Reformulaciones (multi-query)": "Reformulacions (multi-query)",
  "Documento hipotético (HyDE)": "Document hipotètic (HyDE)",
  "Qué hace el reranker": "Què fa el reranker",
  "El bi-encoder compara vectores calculados por separado; el cross-encoder lee la pregunta y el chunk juntos y estima directamente su relevancia. Es mucho más lento, por eso solo se aplica a los candidatos de la fusión.":
    "El bi-encoder compara vectors calculats per separat; el cross-encoder llig la pregunta i el chunk junts i estima directament la seua rellevància. És molt més lent, per això només s'aplica als candidats de la fusió.",
  "Modelo: {model} · {n} candidatos en {ms}.": "Model: {model} · {n} candidats en {ms}.",
  "Score del reranker por candidato": "Score del reranker per candidat",
  "Orden del contexto": "Ordre del context",
  "inicio del prompt": "inici del prompt",
  "final del prompt": "final del prompt",
  "Los fragmentos se reordenan para que los más relevantes queden al principio y al final del prompt, y los peores en el centro: los LLM atienden peor a lo que está en medio de un contexto largo (lost in the middle).":
    "Els fragments es reordenen perquè els més rellevants queden al principi i al final del prompt, i els pitjors al centre: els LLM atenen pitjor allò que està enmig d'un context llarg (lost in the middle).",
  "Esta arquitectura pasa los fragmentos en orden de score, sin reordenar.": "Esta arquitectura passa els fragments en ordre de score, sense reordenar-los.",
  "La altura de cada barra es la relevancia (rank #1 = la más alta).": "L'altura de cada barra és la rellevància (rank #1 = la més alta).",
  "Cargando proyección…": "Carregant la projecció…",
  "Proyección PCA de {n} chunks del índice «{index}»; los dos ejes conservan el {pct}% de la varianza, así que las distancias son orientativas. Rueda para hacer zoom, arrastra para moverte, doble clic para centrar.":
    "Projecció PCA de {n} chunks de l'índex «{index}»; els dos eixos conserven el {pct} % de la variància, així que les distàncies són orientatives. Roda per a fer zoom, arrossega per a moure't, doble clic per a centrar.",
  "Analizando…": "Analitzant…",
  "Apoyo más cercano: fragmento {n} · similitud {sim}": "Suport més pròxim: fragment {n} · similitud {sim}",
  "Cita": "Cita",
  "coherente": "coherent",
  "el mejor apoyo está en otro fragmento": "el millor suport està en un altre fragment",
  "Frase sin cita": "Frase sense cita",
  "apoyo fuerte": "suport fort",
  "apoyo parcial": "suport parcial",
  "sin apoyo cercano": "sense suport pròxim",
  "· similitud media {sim} · señal aproximada con embeddings": "· similitud mitjana {sim} · senyal aproximat amb embeddings",
  "Retrieval": "Retrieval",
  "Reranking": "Reranking",
  "Reformulación": "Reformulació",
  "2ª pasada": "2a passada",

  // ---------------------------------------------------------------- Comparar
  "Una pregunta para todas las arquitecturas…": "Una pregunta per a totes les arquitectures…",
  "La misma pregunta, varias familias de RAG. ¿Usan las mismas disposiciones? ¿Cuánto cuesta cada mejora?":
    "La mateixa pregunta, diverses famílies de RAG. Usen les mateixes disposicions? Quant costa cada millora?",
  "Generar respuestas": "Genera les respostes",
  "Elige al menos una arquitectura": "Tria almenys una arquitectura",
  "Respuestas": "Respostes",
  "Se ejecutan una detrás de otra": "S'executen una darrere de l'altra",
  "En cola…": "En cua…",
  "Solo retrieval: estos son los fragmentos que recibiría el LLM.": "Només retrieval: estos són els fragments que rebria l'LLM.",
  "Disposición": "Disposició",
  "Análisis": "Anàlisi",
  "Disposiciones en el contexto": "Disposicions en el context",
  "El número es la posición por relevancia en cada arquitectura": "El número és la posició per rellevància en cada arquitectura",
  "Solapamiento": "Solapament",
  "Índice de Jaccard entre las disposiciones que usa cada una": "Índex de Jaccard entre les disposicions que usa cadascuna",
  "Coste en tiempo": "Cost en temps",
  "Barras proporcionales al tiempo total, por etapa": "Barres proporcionals al temps total, per etapa",

  // ---------------------------------------------------------------- Corpus i fitxa de disposició
  "{n} disposiciones del DOGV indexadas dos veces: una por cada estrategia de chunking.": "{n} disposicions del DOGV indexades dues vegades: una per cada estratègia de chunking.",
  "(sin dato)": "(sense dades)",
  "{n} disposiciones": "{n} disposicions",
  "Buscar por título, código u organismo…": "Busca per títol, codi o organisme…",
  "Todas las secciones": "Totes les seccions",
  "{n} de {total}": "{n} de {total}",
  "disposiciones": "disposicions",
  "mediana {n} car.": "mediana {n} car.",
  "texto vecino recortado": "text veí retallat",
  "Por sección": "Per secció",
  "Organismos con más disposiciones": "Organismes amb més disposicions",
  "Por número del DOGV": "Per número del DOGV",
  "Fecha de publicación": "Data de publicació",
  "Tamaño de los chunks": "Grandària dels chunks",
  "En caracteres. El chunker fijo corta siempre cerca de 1.200; el estructural varía con artículos y apartados":
    "En caràcters. El chunker fix sempre talla prop de 1.200; l'estructural varia segons els articles i els apartats",
  "Disposiciones": "Disposicions",
  "Código": "Codi",
  "Fecha": "Data",
  "Título": "Títol",
  "Caracteres": "Caràcters",
  "Adv.": "Adv.",
  "Pulsa una fila para ver la disposición completa y cómo la trocea cada chunker.": "Polsa una fila per a veure la disposició completa i com la trosseja cada chunker.",
  "Fuente: {root} (variante «{variant}»).": "Font: {root} (variant «{variant}»).",
  "DOGV núm.": "DOGV núm.",
  "{n} caracteres": "{n} caràcters",
  "{n} chunks · mediana {m} caracteres": "{n} chunks · mediana {m} caràcters",
  "(El índice naive no añade cabecera: el chunk se embebe tal cual.)": "(L'índex naive no afig capçalera: el chunk es convertix en embedding tal com està.)",
  "Recorte a la disposición": "Retall a la disposició",
  "Longitud": "Longitud",
  "Título en el otro idioma:": "Títol en l'altre idioma:",
  "Cada segmento es un chunk; pulsa uno para localizarlo en el texto.": "Cada segment és un chunk; polsa'n un per a localitzar-lo en el text.",
  "Qué texto ve el retriever (cabecera contextual)": "Quin text veu el retriever (capçalera contextual)",
  "El índice avanzado antepone a cada chunk una cabecera determinista con número, fecha, organismo, sección, título y apartado (contextual retrieval sin LLM). El naive embebe el fragmento sin contexto.":
    "L'índex avançat anteposa a cada chunk una capçalera determinista amb número, data, organisme, secció, títol i apartat (contextual retrieval sense LLM). El naive convertix el fragment en embedding sense context.",
  "por código de inserción": "pel codi d'inserció",
  "por título oficial": "pel títol oficial",
  "sin recorte": "sense retall",
  "Tamaño fijo (naive)": "Grandària fixa (naive)",
  "Estructural (advanced)": "Estructural (advanced)",

  // ---------------------------------------------------------------- Mapa
  "Proyecta una consulta sobre el mapa…": "Projecta una consulta sobre el mapa…",
  "Cargando…": "Carregant…",
  "{n} chunks del índice «{index}». PCA a 2 dimensiones: conserva el {pct}% de la varianza, así que la cercanía es orientativa (dos puntos alejados en el mapa pueden estar cerca en {dim} dimensiones).":
    "{n} chunks de l'índex «{index}». PCA a 2 dimensions: conserva el {pct} % de la variància, així que la proximitat és orientativa (dos punts allunyats en el mapa poden estar pròxims en {dim} dimensions).",
  "otras secciones": "altres seccions",
  "{name} recupera:": "{name} recupera:",
  "Cada punto es un chunk. Lo que está cerca habla de lo mismo; la estrella es tu consulta.": "Cada punt és un chunk. El que està a prop parla del mateix; l'estrela és la teua consulta.",
  "Proyectar": "Projecta",
  "Rueda: zoom · arrastrar: mover · doble clic: centrar · pulsa una sección para ocultarla.": "Roda: zoom · arrossegar: moure · doble clic: centrar · polsa una secció per a amagar-la.",
  "consulta": "consulta",

  // ---------------------------------------------------------------- Avaluació
  "Títulos cruzados": "Títols creuats",
  "La consulta es el título oficial en el otro idioma (castellano contra el índice en valenciano). Sin LLM. Test de humo cross-lingual: favorece a los índices con el título en la cabecera, así que detecta fallos más que decidir entre arquitecturas.":
    "La consulta és el títol oficial en l'altre idioma (castellà contra l'índex en valencià). Sense LLM. Prova de fum cross-lingual: afavorix els índexs amb el títol en la capçalera, així que detecta errors més que no decidir entre arquitectures.",
  "Preguntas sintéticas": "Preguntes sintètiques",
  "El LLM escribe una pregunta a partir de un chunk al azar; la respuesta correcta es su disposición. Más realista; revisa una muestra antes de fiarte.":
    "L'LLM escriu una pregunta a partir d'un chunk a l'atzar; la resposta correcta és la seua disposició. Més realista; revisa'n una mostra abans de refiar-te'n.",
  "Mis preguntas": "Les meues preguntes",
  "Tu propio conjunto: una línea por pregunta con el código de la disposición que la responde, separados por «|».":
    "El teu propi conjunt: una línia per pregunta amb el codi de la disposició que la respon, separats per «|».",
  "Número de preguntas": "Nombre de preguntes",
  "Evaluar": "Avalua",
  "¿Encuentra cada arquitectura la disposición que contiene la respuesta? Medido a nivel de disposición, como en el notebook.":
    "Troba cada arquitectura la disposició que conté la resposta? Mesurat en l'àmbit de disposició, com en el notebook.",
  "Conjunto de preguntas": "Conjunt de preguntes",
  "Las preguntas sintéticas necesitan un LLM conectado": "Les preguntes sintètiques necessiten un LLM connectat",
  "Corrective sin LLM equivale a Advanced en retrieval. Con reranker en CPU, cada pregunta tarda unos segundos.":
    "Corrective sense LLM equival a Advanced en retrieval. Amb reranker en CPU, cada pregunta tarda uns quants segons.",
  "Escribe al menos una línea «pregunta | código»": "Escriu almenys una línia «pregunta | codi»",
  "Completado en {s} s": "Completat en {s} s",
  "Completado": "Completat",
  "Evaluando…": "Avaluant…",
  "Generando preguntas con el LLM…": "Generant preguntes amb l'LLM…",
  "Arquitectura": "Arquitectura",
  "IC 95% MRR": "IC 95 % MRR",
  "s/consulta": "s/consulta",
  "Comparación pareada (bootstrap, 2.000 remuestreos)": "Comparació aparellada (bootstrap, 2.000 remostratges)",
  "supera a": "supera",
  "en MRR en el {pct}% de los remuestreos (Δ = {d})": "en MRR en el {pct} % dels remostratges (Δ = {d})",
  "Por encima del 95% la diferencia es robusta a qué preguntas se hayan muestreado; con pocas preguntas los intervalos son anchos.":
    "Per damunt del 95 %, la diferència és robusta respecte de quines preguntes s'hagen mostrejat; amb poques preguntes, els intervals són amples.",
  "Resultados": "Resultats",
  "hit@k y MRR": "hit@k i MRR",
  "{n} preguntas · más alto es mejor": "{n} preguntes · com més alt, millor",
  "Tabla": "Taula",
  "Latencia del retrieval": "Latència del retrieval",
  "Segundos por consulta (sin generación)": "Segons per consulta (sense generació)",
  "Pregunta a pregunta": "Pregunta a pregunta",
  "Posición de la disposición correcta (✕ = fuera del top 10). Arriba, las más difíciles.": "Posició de la disposició correcta (✕ = fora del top 10). Dalt, les més difícils.",
  "Proporción de preguntas en las que la disposición correcta aparece entre las k primeras (contando cualquiera de sus chunks).":
    "Proporció de preguntes en què la disposició correcta apareix entre les k primeres (comptant qualsevol dels seus chunks).",
  "Media del inverso de la posición de la primera disposición correcta; 0 si no está en el top 10. Premia acertar arriba.":
    "Mitjana de l'invers de la posició de la primera disposició correcta; 0 si no està en el top 10. Premia l'encert en les primeres posicions.",
  "Latencia": "Latència",
  "Tiempo medio del retrieval (embedding, búsqueda, fusión y reranking). La generación se mide aparte en Preguntar y Comparar.":
    "Temps mitjà del retrieval (embedding, cerca, fusió i reranking). La generació es mesura a banda en Preguntar i Comparar.",

  // ---------------------------------------------------------------- grafs i diagrama de recorregut
  "esperando…": "esperant…",
  "Lanza una pregunta para ver cómo se mueven los candidatos entre etapas.": "Llança una pregunta per a veure com es mouen els candidats entre etapes.",
  "Etapas de la arquitectura {name}": "Etapes de l'arquitectura {name}",
  "filtro: {n} chunks": "filtre: {n} chunks",
  "Vector de {dim} dimensiones (norma {norm}).": "Vector de {dim} dimensions (norma {norm}).",
  "{n} términos": "{n} termes",
  "{n} listas · {k}": "{n} llistes · {k}",
  "{n} candidatos": "{n} candidats",
  "generando…": "generant…",
  "reformulando…": "reformulant…",
  "se abstiene": "s'absté",
  "{n} fragmentos": "{n} fragments",
  "sin LLM": "sense LLM",
  "La pregunta tal como la escribe el usuario.": "La pregunta tal com l'escriu la persona usuària.",
  "Embedding": "Embedding",
  "El bi-encoder convierte la consulta en un vector normalizado.": "El bi-encoder convertix la consulta en un vector normalitzat.",
  "Tokenizado": "Tokenització",
  "Minúsculas, sin acentos ni stopwords y stemming Snowball (catalán).": "Minúscules, sense accents ni paraules buides i stemming Snowball (català).",
  "Similitud coseno entre la consulta y todos los chunks (búsqueda exacta).": "Similitud cosinus entre la consulta i tots els chunks (cerca exacta).",
  "BM25": "BM25",
  "Ranking léxico: términos de la consulta presentes en el chunk, ponderados por IDF y longitud.": "Rànquing lèxic: termes de la consulta presents en el chunk, ponderats per IDF i longitud.",
  "Fusión RRF": "Fusió RRF",
  "Reciprocal Rank Fusion: suma 1/(k+rango) de cada lista; ignora la escala de los scores.": "Reciprocal Rank Fusion: suma 1/(k+posició) de cada llista; ignora l'escala dels scores.",
  "Dedup · top-N": "Dedup · top-N",
  "Quita textos duplicados, conserva un idioma por disposición y corta a los N candidatos.": "Lleva els textos duplicats, conserva un idioma per disposició i retalla als N candidats.",
  "Reranker": "Reranker",
  "Cross-encoder: lee consulta y chunk juntos y puntúa su relevancia (0-1).": "Cross-encoder: llig la consulta i el chunk junts i puntua la seua rellevància (0-1).",
  "Evaluador": "Avaluador",
  "Compara el mejor score del reranker con τ_ok y τ_abstain.": "Compara el millor score del reranker amb τ_ok i τ_abstain.",
  "Reformular": "Reformular",
  "El LLM reformula la pregunta y escribe un párrafo hipotético; se busca otra vez.": "L'LLM reformula la pregunta i escriu un paràgraf hipotètic; es torna a buscar.",
  "Top-k fragmentos, reordenados (lost in the middle) y recortados al presupuesto.": "Top-k fragments, reordenats (lost in the middle) i retallats al pressupost.",
  "LLM": "LLM",
  "Genera la respuesta citando los fragmentos [n].": "Genera la resposta citant els fragments [n].",
  "si es flojo": "si és feble",

  // ---------------------------------------------------------------- Arquitectures
  "Cuatro arquitecturas, de la más simple a la más cuidadosa. Cada una añade una pieza y se puede medir qué aporta.":
    "Quatre arquitectures, de la més simple a la més acurada. Cadascuna afig una peça i es pot mesurar què aporta.",
  "Animar": "Anima",
  "Conceptos clave": "Conceptes clau",
  "Propuestas para ampliar el estudio": "Propostes per a ampliar l'estudi",
  "Referencias": "Referències",
  "taxonomía naive / advanced / modular": "taxonomia naive / advanced / modular",
  "Naive RAG": "Naive RAG",
  "El esquema original: trocear, embeber, buscar los k vecinos más cercanos y pasarlos al LLM.":
    "L'esquema original: trossejar, convertir en embeddings, buscar els k veïns més pròxims i passar-los a l'LLM.",
  "Chunks de tamaño fijo (1.200 caracteres, solapamiento de 150), cortados en el espacio más cercano.":
    "Chunks de grandària fixa (1.200 caràcters, solapament de 150), tallats en l'espai més pròxim.",
  "Un único bi-encoder (multilingual-e5 / BGE-M3) para consulta y documentos; similitud coseno exacta.":
    "Un únic bi-encoder (multilingual-e5 / BGE-M3) per a la consulta i els documents; similitud cosinus exacta.",
  "Sin cabecera contextual: el chunk se embebe sin saber a qué disposición pertenece.":
    "Sense capçalera contextual: el chunk es convertix en embedding sense saber a quina disposició pertany.",
  "Línea base: barata y rápida, pero frágil ante códigos, nombres propios y preguntas ambiguas.":
    "Línia base: barata i ràpida, però fràgil davant de codis, noms propis i preguntes ambigües.",
  "score(q, c) = cos(E(q), E(c)) = E(q) · E(c)   (vectores normalizados)": "score(q, c) = cos(E(q), E(c)) = E(q) · E(c)   (vectors normalitzats)",
  "Híbrido (ablation)": "Híbrid (ablation)",
  "Advanced sin reranker: aísla cuánto aportan el chunking estructural, la cabecera y la fusión léxico-densa.":
    "Advanced sense reranker: aïlla quant aporten el chunking estructural, la capçalera i la fusió lèxica i densa.",
  "Chunking por estructura del DOGV: encabezados, artículos, disposiciones, anexos y tablas.":
    "Chunking per l'estructura del DOGV: encapçalaments, articles, disposicions, annexos i taules.",
  "Cabecera determinista (número, fecha, organismo, sección, título, apartado) delante de cada chunk.":
    "Capçalera determinista (número, data, organisme, secció, títol, apartat) davant de cada chunk.",
  "BM25 con stemming catalán y denso en paralelo, fusionados con Reciprocal Rank Fusion.":
    "BM25 amb stemming català i dens en paral·lel, fusionats amb Reciprocal Rank Fusion.",
  "Prefiltro por metadatos antes de buscar (organismo, sección, fechas, número de DOGV).":
    "Prefiltre per metadades abans de buscar (organisme, secció, dates, número de DOGV).",
  "RRF(c) = Σ_listas  w_i / (k + rango_i(c)),   k = 60": "RRF(c) = Σ_llistes  w_i / (k + posició_i(c)),   k = 60",
  "Advanced RAG": "Advanced RAG",
  "Pre-retrieval y post-retrieval: mejor indexado, búsqueda híbrida y un reranker que relee los candidatos.":
    "Pre-retrieval i post-retrieval: millor indexació, cerca híbrida i un reranker que torna a llegir els candidats.",
  "Todo lo del híbrido, más un cross-encoder (bge-reranker-v2-m3) sobre los N mejores candidatos.":
    "Tot el de l'híbrid, més un cross-encoder (bge-reranker-v2-m3) sobre els N millors candidats.",
  "Deduplicación por hash del texto y un solo idioma por disposición en índices bilingües.":
    "Deduplicació per hash del text i un sol idioma per disposició en índexs bilingües.",
  "Expansión opcional a chunks vecinos (small-to-big) y fusión de trozos contiguos.":
    "Expansió opcional a chunks veïns (small-to-big) i fusió de trossos contigus.",
  "Reordenación «lost in the middle»: lo mejor al principio y al final del prompt.":
    "Reordenació «lost in the middle»: el millor al principi i al final del prompt.",
  "BM25(q, c) = Σ_t IDF(t) · f(t,c)(k1+1) / (f(t,c) + k1(1 − b + b·|c|/avgdl))": "BM25(q, c) = Σ_t IDF(t) · f(t,c)(k1+1) / (f(t,c) + k1(1 − b + b·|c|/avgdl))",
  "Corrective RAG": "Corrective RAG",
  "Un evaluador decide si el retrieval es fiable antes de generar: si no lo es, corrige; si sigue sin serlo, se abstiene.":
    "Un avaluador decidix si el retrieval és fiable abans de generar: si no ho és, corregix; si continua sense ser-ho, s'absté.",
  "Evaluador ligero: el mejor score del reranker frente a τ_ok (correcto) y τ_abstain (incorrecto).":
    "Avaluador lleuger: el millor score del reranker davant de τ_ok (correcte) i τ_abstain (incorrecte).",
  "Si es ambiguo: multi-query (el LLM reformula con vocabulario administrativo) y HyDE (documento hipotético).":
    "Si és ambigu: multi-query (l'LLM reformula amb vocabulari administratiu) i HyDE (document hipotètic).",
  "Segunda pasada híbrida con todas las consultas, reranking y fusión con la primera.":
    "Segona passada híbrida amb totes les consultes, reranking i fusió amb la primera.",
  "Abstención explícita en lugar de una respuesta inventada: prioriza la fidelidad sobre la cobertura.":
    "Abstenció explícita en lloc d'una resposta inventada: prioritza la fidelitat sobre la cobertura.",
  "veredicto = correcto si max s ≥ τ_ok · ambiguo si τ_abstain ≤ max s < τ_ok · incorrecto si no":
    "veredicte = correcte si max s ≥ τ_ok · ambigu si τ_abstain ≤ max s < τ_ok · incorrecte en cas contrari",
  "ambicioso": "ambiciós",
  "medio": "mitjà",
  "fácil": "fàcil",
  "GraphRAG sobre referencias normativas": "GraphRAG sobre referències normatives",
  "Las disposiciones se citan entre sí («Decret 68/2026», «Llei 5/2026», correcciones de errores). Un grafo de referencias extraído con expresiones regulares permitiría recuperar la norma que se desarrolla o corrige (multi-hop) y responder «¿qué está vigente?». Edge et al., 2024.":
    "Les disposicions es citen entre si («Decret 68/2026», «Llei 5/2026», correccions d'errades). Un graf de referències extret amb expressions regulars permetria recuperar la norma que es desplega o es corregix (multi-hop) i respondre «què està vigent?». Edge et al., 2024.",
  "Router adaptativo (Adaptive-RAG)": "Router adaptatiu (Adaptive-RAG)",
  "Un clasificador ligero decide por pregunta si basta Naive, hace falta Advanced/Corrective o no hace falta retrieval. Reduce latencia media sin perder calidad. Jeong et al., 2024.":
    "Un classificador lleuger decidix per a cada pregunta si n'hi ha prou amb Naive, si cal Advanced/Corrective o si no cal retrieval. Reduïx la latència mitjana sense perdre qualitat. Jeong et al., 2024.",
  "Self-query: filtros extraídos de la pregunta": "Self-query: filtres extrets de la pregunta",
  "Que el LLM convierta «subvencions de Sanitat d'octubre» en Filters(organismo, date_from, date_to). Aprovecha el prefiltro que ya existe y que hoy solo se usa a mano.":
    "Que l'LLM convertisca «subvencions de Sanitat d'octubre» en Filters(organismo, date_from, date_to). Aprofita el prefiltre que ja existix i que hui només s'usa a mà.",
  "Evaluación de la generación (RAGAS)": "Avaluació de la generació (RAGAS)",
  "Medir fidelidad, relevancia de la respuesta y precisión/recall del contexto con un LLM juez. La comprobación de fundamentación de esta web es una primera aproximación sin LLM. Es et al., 2023.":
    "Mesurar la fidelitat, la rellevància de la resposta i la precisió/recall del context amb un LLM jutge. La comprovació de fonamentació d'esta web n'és una primera aproximació sense LLM. Es et al., 2023.",
  "Self-RAG / verificación de citas": "Self-RAG / verificació de cites",
  "Que el modelo critique sus propias afirmaciones y re-busque si una frase no está apoyada. Asai et al., 2023.":
    "Que el model critique les seues pròpies afirmacions i torne a buscar si una frase no té suport. Asai et al., 2023.",
  "Retrieval multi-vector con BGE-M3": "Retrieval multivector amb BGE-M3",
  "BGE-M3 da a la vez vectores densos, pesos léxicos y representaciones ColBERT. Comparar late interaction con el híbrido BM25 + denso actual. Khattab & Zaharia, 2020.":
    "BGE-M3 dona alhora vectors densos, pesos lèxics i representacions ColBERT. Comparar la late interaction amb l'híbrid BM25 + dens actual. Khattab & Zaharia, 2020.",
  "Contextual retrieval con LLM": "Contextual retrieval amb LLM",
  "Sustituir la cabecera determinista por un resumen generado por chunk (Anthropic, 2024) y medir la diferencia: ablation directa sobre el índice advanced.":
    "Substituir la capçalera determinista per un resum generat per a cada chunk (Anthropic, 2024) i mesurar-ne la diferència: ablation directa sobre l'índex advanced.",
  "RAPTOR: resúmenes jerárquicos": "RAPTOR: resums jeràrquics",
  "Árbol de resúmenes por número del DOGV y por organismo para preguntas agregadas («¿qué ha publicado Sanitat esta semana?»). Sarthi et al., 2024.":
    "Arbre de resums per número del DOGV i per organisme per a preguntes agregades («què ha publicat Sanitat esta setmana?»). Sarthi et al., 2024.",
  "Rigor estadístico": "Rigor estadístic",
  "Conjunto anotado a mano (~100 preguntas) e intervalos de confianza por bootstrap con pruebas pareadas entre arquitecturas. La vista de Evaluación ya calcula los intervalos.":
    "Conjunt anotat a mà (~100 preguntes) i intervals de confiança per bootstrap amb proves aparellades entre arquitectures. La vista d'Avaluació ja calcula els intervals.",
  "Bi-encoder vs cross-encoder": "Bi-encoder vs. cross-encoder",
  "El bi-encoder embebe consulta y documento por separado: se precalcula el índice y la búsqueda es un producto escalar. El cross-encoder los lee juntos con atención cruzada: mucho más preciso y mucho más caro, por eso solo reordena candidatos.":
    "El bi-encoder convertix la consulta i el document en embeddings per separat: l'índex es precalcula i la cerca és un producte escalar. El cross-encoder els llig junts amb atenció creuada: molt més precís i molt més costós; per això només reordena candidats.",
  "Léxico + semántico": "Lèxic + semàntic",
  "BM25 acierta con términos exactos (códigos de inserción, números de expediente, topónimos); el denso con paráfrasis y sinónimos. RRF los combina por posición, sin calibrar escalas distintas.":
    "BM25 encerta amb termes exactes (codis d'inserció, números d'expedient, topònims); el dens, amb paràfrasis i sinònims. RRF els combina per posició, sense calibrar escales diferents.",
  "Chunking": "Chunking",
  "El tamaño fijo parte artículos por la mitad; el estructural respeta la jerarquía del texto legal y anota el apartado. La cabecera contextual hace que un chunk aislado «sepa» de qué disposición viene.":
    "La grandària fixa partix articles per la mitat; l'estructural respecta la jerarquia del text legal i anota l'apartat. La capçalera contextual fa que un chunk aïllat «sàpia» de quina disposició ve.",
  "Lost in the middle": "Lost in the middle",
  "Los LLM usan peor la información situada en medio de un contexto largo. Reordenar pone los fragmentos más relevantes en los extremos.":
    "Els LLM usen pitjor la informació situada enmig d'un context llarg. Reordenar posa els fragments més rellevants als extrems.",
  "HyDE": "HyDE",
  "Se busca con el embedding de un documento hipotético escrito por el LLM, que se parece más a los documentos reales que la pregunta. Útil cuando la pregunta usa otro registro que el DOGV.":
    "Es busca amb l'embedding d'un document hipotètic escrit per l'LLM, que s'assembla més als documents reals que la pregunta. Útil quan la pregunta usa un registre diferent del del DOGV.",
  "Abstención": "Abstenció",
  "Un sistema que dice «no lo sé» cuando el retrieval es flojo es preferible en un dominio jurídico-administrativo: una respuesta inventada con cita oficial es peor que ninguna.":
    "Un sistema que diu «no ho sé» quan el retrieval és feble és preferible en un domini juridicoadministratiu: una resposta inventada amb cita oficial és pitjor que cap resposta.",

  // ---------------------------------------------------------------- Agentic RAG
  "Un LLM agente planifica: decide qué buscar, con qué filtros, qué leer entero y cuándo parar.":
    "Un LLM agent planifica: decidix què buscar, amb quins filtres, què llegir sencer i quan parar.",
  "Cinco arquitecturas, de la más simple a la más autónoma. Cada una añade una pieza y se puede medir qué aporta.":
    "Cinc arquitectures, de la més simple a la més autònoma. Cadascuna afig una peça i es pot mesurar què aporta.",
  "Agente": "Agent",
  "Un LLM planifica: en cada paso elige buscar, leer una evidencia entera o terminar.":
    "Un LLM planifica: en cada pas tria buscar, llegir una evidència sencera o acabar.",
  "Búsqueda": "Cerca",
  "Búsqueda híbrida (BM25 + denso, RRF) con la consulta y los filtros que decide el agente.":
    "Cerca híbrida (BM25 + densa, RRF) amb la consulta i els filtres que decidix l'agent.",
  "Leer": "Llegir",
  "El agente lee entera una evidencia (con sus chunks vecinos) antes de decidir.":
    "L'agent llig sencera una evidència (amb els seus chunks veïns) abans de decidir.",
  "Evidencias": "Evidències",
  "Resultados que vuelven al agente como observación (E1, E2…). Al terminar, elige cuáles entran al contexto.":
    "Resultats que tornen a l'agent com a observació (E1, E2…). En acabar, tria quins entren al context.",
  "siguiente paso": "pas següent",
  "pensando · paso {n}": "pensant · pas {n}",
  "buscar": "buscar",
  "leer": "llegir",
  "terminar": "acabar",
  "ref no válida": "ref no vàlida",
  "repetida": "repetida",
  "{n} evidencias": "{n} evidències",
  "{n} elegidas de {m}": "{n} triades de {m}",
  "Paso {step}/{max}": "Pas {step}/{max}",
  "Razonamiento:": "Raonament:",
  "(acción por defecto: la salida del LLM no era válida o se acababan los pasos)":
    "(acció per defecte: l'eixida de l'LLM no era vàlida o s'acabaven els passos)",
  "el agente decide {a} {q}": "l'agent decidix {a} {q}",
  "con filtros {f}": "amb filtres {f}",
  "el agente decide {a} la evidencia {ref} para ver el texto completo.":
    "l'agent decidix {a} l'evidència {ref} per a veure el text complet.",
  "el agente decide {a} sin evidencias pertinentes: el sistema se abstendrá.":
    "l'agent decidix {a} sense evidències pertinents: el sistema s'abstindrà.",
  "el agente decide {a} y elige {list}.": "l'agent decidix {a} i tria {list}.",
  "el agente decide {a}.": "l'agent decidix {a}.",
  "Observación": "Observació",
  "El agente lee {ref} entero: {n} caracteres, con los chunks vecinos de la misma disposición.":
    "L'agent llig {ref} sencer: {n} caràcters, amb els chunks veïns de la mateixa disposició.",
  "La referencia {ref} no existe; el agente recibe la lista de referencias válidas.":
    "La referència {ref} no existix; l'agent rep la llista de referències vàlides.",
  "Búsqueda repetida: no se ejecuta y se pide al agente otra consulta.":
    "Cerca repetida: no s'executa i es demana a l'agent una altra consulta.",
  "Vuelven {n} resultados al agente ({nw} nuevos); el mejor, {ref}, con score {s}. El agente solo ve un extracto de cada uno.":
    "Tornen {n} resultats a l'agent ({nw} nous); el millor, {ref}, amb score {s}. L'agent només en veu un extracte de cadascun.",
  "La búsqueda no devuelve nada; el agente tendrá que reformular o quitar filtros.":
    "La cerca no torna res; l'agent haurà de reformular o llevar filtres.",
  "El agente no elige ninguna evidencia: no se generará una respuesta sin apoyo.":
    "L'agent no tria cap evidència: no es generarà una resposta sense suport.",
  "Se agotan los pasos: entran al contexto las {n} evidencias con mejor score de las {m} reunidas.":
    "S'esgoten els passos: entren al context les {n} evidències amb millor score de les {m} reunides.",
  "El agente selecciona {n} de las {m} evidencias reunidas, en su orden de relevancia.":
    "L'agent selecciona {n} de les {m} evidències reunides, en el seu orde de rellevància.",
  "El agente (LLM) repasa la pregunta y lo que ha reunido hasta ahora y decide el siguiente paso…":
    "L'agent (LLM) repassa la pregunta i el que ha reunit fins ara i decidix el pas següent…",
  "Decisión del agente en {ms}.": "Decisió de l'agent en {ms}.",
  "El agente ha usado {n} pasos y {q} búsquedas.": "L'agent ha usat {n} passos i {q} cerques.",
  "Planificación (agente)": "Planificació (agent)",
  "Pasos máximos del agente": "Passos màxims de l'agent",
  "Pasos": "Passos",
  "{n} búsquedas": "{n} cerques",
  "Trayectoria del agente": "Trajectòria de l'agent",
  "Buscar": "Buscar",
  "Terminar": "Acabar",
  "{n} car. leídos": "{n} car. llegits",
  "sin evidencias: abstención": "sense evidències: abstenció",
  "sin lista: se usan las de mejor score": "sense llista: s'usen les de millor score",
  "Búsqueda repetida: no se ejecuta.": "Cerca repetida: no s'executa.",
  "ya vista en un paso anterior": "ja vista en un pas anterior",
  "Ningún resultado.": "Cap resultat.",
  "Paso {n}": "Pas {n}",
  "acción por defecto": "acció per defecte",
  "El agente está decidiendo…": "L'agent està decidint…",
  "Cómo funciona": "Com funciona",
  "En cada paso el LLM recibe la pregunta y todo lo que ha visto hasta ahora, y responde con una acción en JSON: buscar (con la consulta y los filtros que elija), leer entera una evidencia o terminar eligiendo las evidencias.":
    "En cada pas l'LLM rep la pregunta i tot el que ha vist fins ara, i respon amb una acció en JSON: buscar (amb la consulta i els filtres que trie), llegir sencera una evidència o acabar triant les evidències.",
  "Cada búsqueda es la del Advanced (BM25 + denso, RRF y reranker). Las evidencias reciben referencias E1, E2… que el agente usa para elegirlas; al terminar, las elegidas entran al contexto y la respuesta se redacta con el mismo prompt que el resto de arquitecturas.":
    "Cada cerca és la de l'Advanced (BM25 + densa, RRF i reranker). Les evidències reben referències E1, E2… que l'agent usa per a triar-les; en acabar, les triades entren al context i la resposta es redacta amb el mateix prompt que la resta d'arquitectures.",
  "Reunidas": "Reunides",
  "Elegidas": "Triades",
  "Parada": "Parada",
  "decisión del agente": "decisió de l'agent",
  "límite de pasos": "límit de passos",
  "Más caro que Corrective (una llamada al LLM por paso), pero adapta la estrategia a cada pregunta: descompone preguntas compuestas, prueba sinónimos y filtra por organismo o fecha.":
    "Més car que Corrective (una crida a l'LLM per pas), però adapta l'estratègia a cada pregunta: descompon preguntes compostes, prova sinònims i filtra per organisme o data.",
  "El retrieval deja de ser un flujo fijo: un LLM agente decide qué buscar, cómo, cuántas veces y con qué evidencias se queda.":
    "El retrieval deixa de ser un flux fix: un LLM agent decidix què buscar, com, quantes vegades i amb quines evidències es queda.",
  "Bucle ReAct: en cada paso el LLM razona y elige una herramienta (buscar, leer una evidencia entera o terminar).":
    "Bucle ReAct: en cada pas l'LLM raona i tria una eina (buscar, llegir una evidència sencera o acabar).",
  "Cada búsqueda es la de Advanced (BM25 + denso, RRF y reranker), con la consulta y los filtros que propone el agente.":
    "Cada cerca és la d'Advanced (BM25 + densa, RRF i reranker), amb la consulta i els filtres que proposa l'agent.",
  "Descompone preguntas compuestas, reformula si los resultados son flojos y filtra por organismo, sección o fechas.":
    "Descompon preguntes compostes, reformula si els resultats són fluixos i filtra per organisme, secció o dates.",
  "Elige las evidencias que pasan al contexto; si no hay ninguna pertinente, se abstiene. Coste: una llamada al LLM por paso.":
    "Tria les evidències que passen al context; si no n'hi ha cap de pertinent, s'absté. Cost: una crida a l'LLM per pas.",
  "aₜ = LLM(pregunta, o₁…oₜ₋₁) ∈ {search(q, f), read(Eᵢ), finish(E)}   ·   contexto = E elegidas":
    "aₜ = LLM(pregunta, o₁…oₜ₋₁) ∈ {search(q, f), read(Eᵢ), finish(E)}   ·   context = E triades",
};
