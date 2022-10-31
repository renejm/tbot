async function teste() {
    const cleanupHours = process.env.CLEANUP_TIME.split("-").map(h => h = parseInt(h));
    const dt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
    let hour = dt.getHours();
    if (cleanupHours.includes(hour)) console.log(`São ${hour}!!!`);
    else console.log("Não deu!!!");

    console.log(cleanupHours);
}

module.exports = { teste };

teste();
