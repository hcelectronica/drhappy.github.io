export const CARD_EMOJIS = [
  '🍎', '🍌', '🍇', '🍓', '🍒', '🍍', '🥝', '🍉', '🐶', '🐱', '🐰', '🦊', '🐻', '🐼', '🐸',
  '🦁', '🌻', '🌷', '🌵', '🚲', '🚗', '✈️', '⛵', '🎈', '🎁', '⚽', '🎸', '📚', '☕', '🧉',
]

// Parejas "que van juntas" para el modo difícil de las fichas.
export const RELATED_PAIRS: [string, string][] = [
  ['🔑', '🚪'], ['🌧️', '☂️'], ['⚽', '🥅'], ['🐝', '🍯'], ['🧦', '👟'], ['✉️', '📮'],
  ['🍳', '🥚'], ['🐄', '🥛'], ['🎂', '🕯️'], ['🐟', '🎣'], ['📚', '🎓'], ['🔥', '🧯'],
  ['🚗', '⛽'], ['🌱', '💧'], ['🎸', '🎵'], ['🐶', '🦴'], ['🐰', '🥕'], ['💡', '🔌'],
  ['🖌️', '🎨'], ['⏰', '🛏️'], ['☀️', '🕶️'], ['❄️', '🧤'], ['🍞', '🧈'], ['✂️', '📄'],
]

export const WORD_CATEGORIES: string[][] = [
  ['manzana', 'pera', 'banana', 'naranja', 'durazno', 'ciruela', 'uva', 'frutilla', 'mandarina', 'kiwi', 'melón', 'sandía'],
  ['perro', 'gato', 'caballo', 'vaca', 'oveja', 'gallina', 'conejo', 'tortuga', 'loro', 'zorro', 'león', 'jirafa'],
  ['olla', 'sartén', 'cuchara', 'tenedor', 'plato', 'vaso', 'taza', 'cuchillo', 'colador', 'pava', 'mate', 'bombilla'],
  ['camisa', 'pantalón', 'campera', 'bufanda', 'gorro', 'media', 'zapato', 'pollera', 'guante', 'poncho', 'saco', 'cinturón'],
  ['tren', 'colectivo', 'auto', 'bicicleta', 'barco', 'avión', 'moto', 'taxi', 'subte', 'camión', 'tractor', 'lancha'],
  ['mesa', 'silla', 'cama', 'ventana', 'puerta', 'sillón', 'lámpara', 'espejo', 'alfombra', 'ropero', 'escalera', 'cortina'],
  ['río', 'montaña', 'árbol', 'flor', 'piedra', 'lago', 'nube', 'playa', 'bosque', 'volcán', 'isla', 'cascada'],
  ['martillo', 'serrucho', 'llave', 'tornillo', 'pinza', 'clavo', 'destornillador', 'pala', 'rastrillo', 'tijera', 'regla', 'balde'],
  ['guitarra', 'piano', 'violín', 'bombo', 'flauta', 'bandoneón', 'trompeta', 'arpa', 'tambor', 'charango', 'acordeón', 'saxo'],
  ['médico', 'maestra', 'panadero', 'carpintero', 'enfermera', 'bombero', 'cartero', 'cocinero', 'plomero', 'abogado', 'pintor', 'mecánico'],
]

export const SEARCH_THEMES: { name: string; words: string[] }[] = [
  { name: 'Frutas', words: ['MANZANA', 'PERA', 'BANANA', 'NARANJA', 'DURAZNO', 'CIRUELA', 'UVA', 'FRUTILLA', 'KIWI', 'MELON', 'SANDIA', 'LIMON', 'POMELO', 'CEREZA'] },
  { name: 'Animales', words: ['PERRO', 'GATO', 'CABALLO', 'VACA', 'OVEJA', 'GALLINA', 'CONEJO', 'TORTUGA', 'LORO', 'ZORRO', 'LEON', 'JIRAFA', 'CARPINCHO', 'PUMA', 'HORNERO'] },
  { name: 'Ciudades argentinas', words: ['SALTA', 'MENDOZA', 'ROSARIO', 'CORDOBA', 'USHUAIA', 'TANDIL', 'POSADAS', 'NEUQUEN', 'JUJUY', 'PARANA', 'TRELEW', 'LUJAN', 'MERLO', 'BARILOCHE'] },
  { name: 'En la cocina', words: ['OLLA', 'SARTEN', 'CUCHARA', 'TENEDOR', 'PLATO', 'VASO', 'TAZA', 'CUCHILLO', 'COLADOR', 'PAVA', 'HORNO', 'HELADERA', 'MORTERO'] },
  { name: 'El cuerpo', words: ['CABEZA', 'BRAZO', 'PIERNA', 'RODILLA', 'CODO', 'MANO', 'HOMBRO', 'CUELLO', 'ESPALDA', 'TOBILLO', 'OREJA', 'NARIZ', 'CORAZON', 'PULMON'] },
  { name: 'El clima', words: ['LLUVIA', 'VIENTO', 'NIEVE', 'NUBE', 'TRUENO', 'RAYO', 'GRANIZO', 'NIEBLA', 'CALOR', 'HELADA', 'TORMENTA', 'SOL', 'BRISA'] },
  { name: 'Música', words: ['GUITARRA', 'PIANO', 'VIOLIN', 'BOMBO', 'FLAUTA', 'BANDONEON', 'TROMPETA', 'ARPA', 'TAMBOR', 'CHARANGO', 'TANGO', 'ZAMBA', 'CHACARERA', 'FOLCLORE'] },
  { name: 'Oficios', words: ['MEDICO', 'MAESTRA', 'PANADERO', 'CARPINTERO', 'ENFERMERA', 'BOMBERO', 'CARTERO', 'COCINERO', 'PLOMERO', 'PINTOR', 'MECANICO', 'SASTRE', 'HERRERO'] },
]
