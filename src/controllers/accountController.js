const accountService = require('../services/accountService');

exports.addAccount = async (req, res) => {
    try {
        const { user_id, ebay_user_id, token, token_expiration } = req.body;
        const result = await accountService.addAccount({ user_id, ebay_user_id, token, token_expiration });
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAccounts = async (req, res) => {
    try {
        const accounts = await accountService.getAccounts();
        res.status(200).json(accounts);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
