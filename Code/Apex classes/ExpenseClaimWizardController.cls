public with sharing class ExpenseClaimWizardController {

    // ---------- Claim ----------
    @AuraEnabled
    public static Id createDraftClaim(String costCenter, String justification) {
        Expense_Claim__c c = new Expense_Claim__c();
        c.Status__c = 'Draft';
        c.Cost_Center__c = costCenter;
        c.Business_Justification__c = justification;
    
        c.Employee__c = UserInfo.getUserId(); // <-- ADD THIS
    
        insert c;
        return c.Id;
    }


    @AuraEnabled
    public static Expense_Claim__c getClaim(Id claimId) {
        return [
            SELECT Id, Name, Status__c, Cost_Center__c, Business_Justification__c, Total_Expense_Amount__c
            FROM Expense_Claim__c
            WHERE Id = :claimId
            LIMIT 1
        ];
    }

    // ---------- Line items ----------
    @AuraEnabled
    public static List<Expense_Line_Item__c> getLineItems(Id claimId) {
        return [
            SELECT Id, Name, Expense_Type__c, Expense_Date__c, Amount__c, Merchant_Vendor__c, Description__c,
                   Receipt_Required__c, Receipt_Attached__c
            FROM Expense_Line_Item__c
            WHERE Expense_Claim__c = :claimId
            ORDER BY CreatedDate DESC
        ];
    }

    @AuraEnabled
    public static Id addLineItem(
        Id claimId,
        String expenseType,
        Date expenseDate,
        Decimal amount,
        String merchant,
        String description
    ) {
        Expense_Line_Item__c li = new Expense_Line_Item__c();
        li.Expense_Claim__c = claimId;
        li.Expense_Type__c = expenseType;
        li.Expense_Date__c = expenseDate;
        li.Amount__c = amount;
        li.Merchant_Vendor__c = merchant;
        li.Description__c = description;
        insert li;
        return li.Id;
    }

    @AuraEnabled
    public static void deleteLineItem(Id lineItemId) {
        delete [SELECT Id FROM Expense_Line_Item__c WHERE Id = :lineItemId LIMIT 1];
    }

    // ---------- Submit ----------
    @AuraEnabled
    public static void submitClaimForApproval(Id claimId) {
        // 1) Set Status to Submitted (your before-save flow will block if receipts missing)
        Expense_Claim__c c = [SELECT Id, Status__c FROM Expense_Claim__c WHERE Id = :claimId LIMIT 1];
        c.Status__c = 'Submitted';
        update c;

        // 2) Submit to approval process (uses active approval process on Expense_Claim__c)
        Approval.ProcessSubmitRequest req = new Approval.ProcessSubmitRequest();
        req.setObjectId(claimId);
        // Optional: req.setComments('Submitted via wizard');
        Approval.ProcessResult res = Approval.process(req);

        if (!res.isSuccess()) {
            // If submission fails (e.g., no active approval process), throw an error.
            // This will show in the LWC toast.
            String msg = 'Approval submission failed.';
            if (res.getInstanceStatus() != null) msg += ' Status: ' + res.getInstanceStatus();
            throw new AuraHandledException(msg);
        }
    }
}
