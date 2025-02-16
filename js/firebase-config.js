// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, 
    collection, 
    getDocs,
    addDoc,
    deleteDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDbaWTuOs7kH7ZxlK9ow6vt3FPxL-I9CIc",
  authDomain: "pdf-annotator-caltrans.firebaseapp.com",
  projectId: "pdf-annotator-caltrans",
  storageBucket: "pdf-annotator-caltrans.firebasestorage.app",
  messagingSenderId: "48777064427",
  appId: "1:48777064427:web:f79937ee0f38caadc4f3ae"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Function to fetch colors from Firestore
async function fetchColors() {
    try {
        const colorsSnapshot = await getDocs(collection(db, 'colors'));
        return colorsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching colors:', error);
        return [];
    }
}

// Function to fetch labels from Firestore
async function fetchLabels() {
    try {
        const labelsSnapshot = await getDocs(collection(db, 'labels'));
        return labelsSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
    } catch (error) {
        console.error('Error fetching labels:', error);
        return [];
    }
}

export { 
    db, 
    fetchLabels, 
    fetchColors, 
    collection, 
    getDocs, 
    addDoc, 
    deleteDoc, 
    doc 
};
