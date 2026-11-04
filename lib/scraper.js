const axios = require('axios');
const config = require('../config');

async function fetchAPI(base, path, params = {}) {
    const key = config.APIKeys[base] || '';
    const url = `${base}${path}?${new URLSearchParams({ ...params, apikey: key })}`;
    const res = await axios.get(url);
    return res.data;
}

module.exports = { fetchAPI };