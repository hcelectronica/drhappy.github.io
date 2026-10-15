export interface StoryQuestion { q: string; answer: string; wrong: [string, string, string] }
export interface Story { title: string; text: string; questions: StoryQuestion[] }

export const STORIES: Story[] = [
  {
    title: 'Rosa en la feria',
    text: 'El sábado a la mañana, Rosa fue a la feria de la plaza con su nieto Tomás. Compraron dos kilos de tomates, un frasco de miel y un ramo de margaritas amarillas para la mesa. Antes de volver se encontraron con Elena, una vecina, que les contó que el domingo iba a llover. Rosa pagó todo con un billete de diez mil pesos y le sobraron mil quinientos.',
    questions: [
      { q: '¿Qué día fue Rosa a la feria?', answer: 'Sábado', wrong: ['Domingo', 'Viernes', 'Lunes'] },
      { q: '¿Con quién fue?', answer: 'Con su nieto Tomás', wrong: ['Con su hija Elena', 'Con su marido', 'Sola'] },
      { q: '¿Qué flores compraron?', answer: 'Margaritas amarillas', wrong: ['Rosas rojas', 'Claveles blancos', 'Jazmines'] },
      { q: '¿Cómo se llamaba la vecina?', answer: 'Elena', wrong: ['Marta', 'Lucía', 'Rosa'] },
      { q: '¿Qué les contó la vecina?', answer: 'Que el domingo iba a llover', wrong: ['Que se mudaba', 'Que subió la miel', 'Que había un festival'] },
      { q: '¿Cuánto vuelto le sobró a Rosa?', answer: '$1.500', wrong: ['$500', '$2.000', '$1.000'] },
    ],
  },
  {
    title: 'Viaje a Mendoza',
    text: 'En marzo, Carlos y Marta viajaron en micro a Mendoza para ver la Fiesta de la Vendimia. El viaje duró catorce horas. Se alojaron en un hotel frente a la plaza Independencia y el segundo día visitaron una bodega donde probaron un vino malbec. Marta se compró un poncho color marrón y Carlos le sacó cuarenta fotos a la cordillera.',
    questions: [
      { q: '¿En qué mes viajaron?', answer: 'Marzo', wrong: ['Enero', 'Julio', 'Octubre'] },
      { q: '¿En qué viajaron?', answer: 'En micro', wrong: ['En avión', 'En auto', 'En tren'] },
      { q: '¿Cuántas horas duró el viaje?', answer: '14 horas', wrong: ['10 horas', '18 horas', '8 horas'] },
      { q: '¿Frente a qué plaza estaba el hotel?', answer: 'Plaza Independencia', wrong: ['Plaza San Martín', 'Plaza España', 'Plaza de Mayo'] },
      { q: '¿Qué se compró Marta?', answer: 'Un poncho marrón', wrong: ['Una cartera de cuero', 'Un vino malbec', 'Un sombrero'] },
      { q: '¿Cuántas fotos sacó Carlos?', answer: '40', wrong: ['14', '25', '100'] },
    ],
  },
  {
    title: 'El turno de don Alberto',
    text: 'Don Alberto tenía turno con la doctora Sánchez el martes a las diez y media. Llegó al consultorio un cuarto de hora antes, con sus análisis en una carpeta azul. La doctora le tomó la presión, que dio 13 y 8, y le dijo que caminara treinta minutos todos los días. A la salida, Alberto pasó por la farmacia a comprar sus pastillas y un protector solar.',
    questions: [
      { q: '¿Cómo se llamaba la doctora?', answer: 'Sánchez', wrong: ['Gómez', 'Pérez', 'Fernández'] },
      { q: '¿Qué día era el turno?', answer: 'Martes', wrong: ['Lunes', 'Jueves', 'Miércoles'] },
      { q: '¿A qué hora era el turno?', answer: '10:30', wrong: ['10:00', '11:30', '9:45'] },
      { q: '¿De qué color era la carpeta?', answer: 'Azul', wrong: ['Verde', 'Roja', 'Amarilla'] },
      { q: '¿Cuánto le dio la presión?', answer: '13 y 8', wrong: ['12 y 7', '14 y 9', '15 y 10'] },
      { q: '¿Qué le recomendó la doctora?', answer: 'Caminar 30 minutos por día', wrong: ['Nadar dos veces por semana', 'Dejar el café', 'Dormir la siesta'] },
    ],
  },
  {
    title: 'El cumpleaños de Sofía',
    text: 'Sofía cumplió siete años y lo festejó en el patio de la casa de su abuela. Hubo veinte invitados, un mago que hizo aparecer una paloma y una torta de chocolate con frutillas. El regalo que más le gustó fue una bicicleta roja que le trajo su tío Raúl. La fiesta terminó a las ocho de la noche, cuando empezó a refrescar.',
    questions: [
      { q: '¿Cuántos años cumplió Sofía?', answer: '7', wrong: ['5', '8', '10'] },
      { q: '¿Dónde fue el festejo?', answer: 'En el patio de la abuela', wrong: ['En un salón', 'En la escuela', 'En una plaza'] },
      { q: '¿Qué hizo aparecer el mago?', answer: 'Una paloma', wrong: ['Un conejo', 'Un pañuelo', 'Una moneda'] },
      { q: '¿De qué era la torta?', answer: 'Chocolate con frutillas', wrong: ['Dulce de leche', 'Vainilla con duraznos', 'Limón'] },
      { q: '¿Quién le regaló la bicicleta?', answer: 'Su tío Raúl', wrong: ['Su abuela', 'Su papá', 'Su tía Ana'] },
      { q: '¿A qué hora terminó la fiesta?', answer: 'A las 8 de la noche', wrong: ['A las 6 de la tarde', 'A las 10 de la noche', 'A las 7 de la tarde'] },
    ],
  },
  {
    title: 'Bochas en el club',
    text: 'Todos los jueves, Héctor juega a las bochas en el club Sportivo del barrio. Esta semana jugó en pareja con su amigo Rubén contra los hermanos Ríos. Ganaron por quince a once después de casi dos horas. Para festejar, comieron un sándwich de milanesa y Rubén prometió traer una pizza casera el jueves siguiente.',
    questions: [
      { q: '¿Qué día juega Héctor?', answer: 'Los jueves', wrong: ['Los martes', 'Los sábados', 'Los domingos'] },
      { q: '¿Cómo se llama el club?', answer: 'Sportivo', wrong: ['Social', 'Atlético', 'Unión'] },
      { q: '¿Con quién jugó en pareja?', answer: 'Con Rubén', wrong: ['Con su hermano', 'Con Ríos', 'Con Alberto'] },
      { q: '¿Cómo terminó el partido?', answer: '15 a 11', wrong: ['15 a 13', '12 a 10', '11 a 15'] },
      { q: '¿Qué comieron para festejar?', answer: 'Sándwich de milanesa', wrong: ['Empanadas', 'Asado', 'Choripán'] },
      { q: '¿Qué prometió traer Rubén?', answer: 'Una pizza casera', wrong: ['Una torta', 'Facturas', 'Un vino'] },
    ],
  },
  {
    title: 'El jardín de Ana',
    text: 'Ana dedicó la mañana del domingo a su jardín. Plantó seis rosales junto a la reja y sembró albahaca y perejil en unas macetas de barro. Mientras trabajaba, su gato Pancho dormía al sol sobre el banco de madera. Al mediodía regó todo con la manguera verde y después se tomó unos mates con su hermana Clara.',
    questions: [
      { q: '¿Qué día trabajó Ana en el jardín?', answer: 'Domingo', wrong: ['Sábado', 'Viernes', 'Lunes'] },
      { q: '¿Cuántos rosales plantó?', answer: '6', wrong: ['4', '8', '3'] },
      { q: '¿Qué sembró en las macetas?', answer: 'Albahaca y perejil', wrong: ['Tomates y lechuga', 'Menta y orégano', 'Margaritas'] },
      { q: '¿Cómo se llamaba el gato?', answer: 'Pancho', wrong: ['Tito', 'Félix', 'Michi'] },
      { q: '¿Dónde dormía el gato?', answer: 'Sobre el banco de madera', wrong: ['En la maceta', 'Bajo el rosal', 'En la cocina'] },
      { q: '¿Con quién tomó mate?', answer: 'Con su hermana Clara', wrong: ['Con su vecina', 'Con su hija', 'Sola'] },
    ],
  },
  {
    title: 'Un llamado desde España',
    text: 'El viernes a la noche sonó el teléfono: era Lucía, la sobrina de Norma, que vive en Valencia desde hace cinco años. Le contó que consiguió trabajo en una biblioteca y que en diciembre viene de visita con su novio, que se llama Javier. Norma, muy contenta, anotó la fecha en el almanaque de la cocina: llegan el día 18.',
    questions: [
      { q: '¿Quién llamó?', answer: 'Lucía, la sobrina', wrong: ['Clara, la hija', 'Javier, el novio', 'Una amiga'] },
      { q: '¿En qué ciudad vive?', answer: 'Valencia', wrong: ['Madrid', 'Barcelona', 'Sevilla'] },
      { q: '¿Hace cuántos años vive allá?', answer: '5', wrong: ['2', '10', '3'] },
      { q: '¿Dónde consiguió trabajo?', answer: 'En una biblioteca', wrong: ['En un hospital', 'En una escuela', 'En un banco'] },
      { q: '¿Cómo se llama el novio?', answer: 'Javier', wrong: ['Julián', 'Pablo', 'Joaquín'] },
      { q: '¿Qué día de diciembre llegan?', answer: 'El 18', wrong: ['El 8', 'El 24', 'El 15'] },
    ],
  },
  {
    title: 'Bingo en la parroquia',
    text: 'La parroquia del barrio organizó un bingo a beneficio para arreglar el techo del salón. Cada cartón costaba dos mil pesos y se juntaron ochenta personas. Mirta ganó el primer premio, una licuadora, cantando bingo con el número cuarenta y cuatro. El padre Miguel agradeció a todos y anunció que el próximo bingo será en abril.',
    questions: [
      { q: '¿Para qué se juntaba la plata?', answer: 'Para arreglar el techo', wrong: ['Para un viaje', 'Para comprar sillas', 'Para la fiesta patronal'] },
      { q: '¿Cuánto costaba cada cartón?', answer: '$2.000', wrong: ['$1.000', '$5.000', '$1.500'] },
      { q: '¿Cuántas personas fueron?', answer: '80', wrong: ['50', '120', '40'] },
      { q: '¿Quién ganó el primer premio?', answer: 'Mirta', wrong: ['Marta', 'Norma', 'Elsa'] },
      { q: '¿Qué ganó?', answer: 'Una licuadora', wrong: ['Una tostadora', 'Una bicicleta', 'Un televisor'] },
      { q: '¿Con qué número cantó bingo?', answer: '44', wrong: ['14', '40', '47'] },
    ],
  },
]
