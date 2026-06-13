import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc } from "firebase/firestore";
import fs from "fs";

const firebaseConfig = JSON.parse(fs.readFileSync('./firebase-applet-config.json', 'utf8'));
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const run = async () => {
    try {
        const s = await getDocs(collection(db, 'machines'));
        console.log("Machines count:", s.docs.length);
        const m = s.docs.map(d => d.data());
        console.log(m);

        const ps = await getDocs(collection(db, 'production_records'));
        console.log("Production count:", ps.docs.length);
    } catch(e) {
        console.error(e);
    }
};
run();
