const axios = require('axios');

// Configure the Strapi API URL and Authentication
const strapiBaseUrl = 'http://127.0.0.1:1337/api/museum-objects'; // Use 127.0.0.1 instead of localhost
const API_TOKEN = '9e9be33423d0974bdc0b00a98b1d2a596d596dcc8d805befd157641cd975c09d735a8fc9db5a98632fadd1c28cfa7f97015b2a14285c948d82b55e20994db295a21588a61cbb0f11446d1b0a5cad481e3e91329ead22a07bfac35805589cf3ab60cac8eddea736f8e069969ab85c53b675dfd2c359b7ea2e1bedcfb199fdcea3'; // Replace with your actual token

// Axios instance with authorization header
const axiosInstance = axios.create({
    baseURL: strapiBaseUrl,
    headers: {
        Authorization: `Bearer ${strapiToken}`,
        'Content-Type': 'application/json'
    }
});

// Function to create a category
async function createCategory(name) {
    try {
        const response = await axiosInstance.post('/categories', {
            data: { name }
        });
        return response.data.data.id;
    } catch (error) {
        console.error(`Error creating category ${name}:`, error.response.data);
        return null;
    }
}

// Function to create a subcategory and link it to a category
async function createSubcategory(name, categoryId) {
    try {
        const response = await axiosInstance.post('/subcategories', {
            data: {
                name,
                category: categoryId
            }
        });
        return response.data.data.id;
    } catch (error) {
        console.error(`Error creating subcategory ${name}:`, error.response.data);
        return null;
    }
}

// Function to link an object to a subcategory
async function linkObjectToSubcategory(objectId, subcategoryId) {
    try {
        await axiosInstance.put(`/museum-objects/${objectId}`, {
            data: {
                subcategory: subcategoryId
            }
        });
    } catch (error) {
        console.error(`Error linking object ${objectId} to subcategory ${subcategoryId}:`, error.response.data);
    }
}

// Main function to create categories, subcategories and link objects
async function main() {
    // Create categories
    const ancientArtCategoryId = await createCategory('Ancient Art and Archaeology');
    const africaArtCategoryId = await createCategory('Art and Architecture of Africa and the African Diaspora');

    // Create subcategories and link to parent categories
    const greekSubcategoryId = await createSubcategory('Greek', ancientArtCategoryId);
    const romanSubcategoryId = await createSubcategory('Roman', ancientArtCategoryId);
    const westAsianSubcategoryId = await createSubcategory('West Asian (Near Eastern)', ancientArtCategoryId);

    // Link objects to subcategories (replace these IDs with actual object IDs in your database)
    await linkObjectToSubcategory(1, greekSubcategoryId);  // Replace 1 with actual object ID
    await linkObjectToSubcategory(2, romanSubcategoryId);  // Replace 2 with actual object ID
    await linkObjectToSubcategory(3, westAsianSubcategoryId);  // Replace 3 with actual object ID

    console.log('Data population completed.');
}

// Execute the main function
main();
